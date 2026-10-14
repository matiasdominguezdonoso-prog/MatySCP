package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

//go:embed sites.json
var embeddedSitesJSON []byte

type RemoteFile struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	IsDir   bool   `json:"is_dir"`
	ModTime string `json:"mod_time"`
}

type LocalFile struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	IsDir   bool   `json:"is_dir"`
	ModTime string `json:"mod_time"`
}

type Site struct {
	ID     string `json:"id"`
	Nombre string `json:"nombre"`
	Hops   []Hop  `json:"hops"`
}

type App struct {
	ctx        context.Context
	sites      []Site
	sftpClient *sftp.Client
	session    *TunnelSession

	// Control de nodo Peer (Activo / Backup)
	isPeer      bool
	backupSFTP  *sftp.Client
	peerSession *ssh.Session
	peerSFTP    *sftp.Client

	// Metadatos de la conexión actual
	currentIP       string
	currentHostname string
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	data, err := os.ReadFile("sites.json")
	if err != nil {
		data = embeddedSitesJSON
	}

	if err := json.Unmarshal(data, &a.sites); err != nil {
		fmt.Printf("Error parseando faenas: %v\n", err)
	}
}

func (a *App) GetSites() []Site {
	return a.sites
}

// GetConnectionInfo devuelve la IP y el Hostname del servidor actual al frontend
func (a *App) GetConnectionInfo() map[string]string {
	return map[string]string{
		"ip":       a.currentIP,
		"hostname": a.currentHostname,
	}
}

func (a *App) ConnectSite(siteID string) (string, error) {
	a.Disconnect()

	var targetSite *Site
	for _, s := range a.sites {
		if s.ID == siteID {
			targetSite = &s
			break
		}
	}

	if targetSite == nil {
		return "", fmt.Errorf("faena no encontrada")
	}

	sess, err := ConnectChain(targetSite.Hops)
	if err != nil {
		return "", fmt.Errorf("error al conectar: %w", err)
	}

	a.session = sess
	a.sftpClient = sess.SFTPClient
	a.currentIP = sess.RealIP
	a.currentHostname = sess.Hostname

	return fmt.Sprintf("Conectado exitosamente a %s", targetSite.Nombre), nil
}

func (a *App) Disconnect() {
	if a.peerSFTP != nil {
		a.peerSFTP.Close()
		a.peerSFTP = nil
	}
	if a.peerSession != nil {
		a.peerSession.Close()
		a.peerSession = nil
	}
	a.isPeer = false
	a.backupSFTP = nil

	if a.session != nil {
		a.session.Close()
		a.session = nil
	}
	a.sftpClient = nil
	a.currentIP = ""
	a.currentHostname = ""
}

// ========================================================
// CONTROL PEER (ACTIVO/BACKUP)
// ========================================================

func (a *App) IsPeer() bool {
	return a.isPeer
}

func (a *App) TogglePeer() (string, error) {
	if a.session == nil || a.session.SSHClient == nil {
		return "", fmt.Errorf("no hay conexión activa con la faena")
	}

	if a.isPeer {
		if a.peerSFTP != nil {
			a.peerSFTP.Close()
			a.peerSFTP = nil
		}
		if a.peerSession != nil {
			a.peerSession.Close()
			a.peerSession = nil
		}

		a.sftpClient = a.backupSFTP
		a.isPeer = false
		return "Conexión restaurada al nodo inicial", nil
	}

	peerSession, err := a.session.SSHClient.NewSession()
	if err != nil {
		return "", fmt.Errorf("error abriendo sesión para lanzar peer: %w", err)
	}

	stdin, err := peerSession.StdinPipe()
	if err != nil {
		peerSession.Close()
		return "", err
	}
	stdout, err := peerSession.StdoutPipe()
	if err != nil {
		peerSession.Close()
		return "", err
	}

	err = peerSession.Start("ssh -q -o StrictHostKeyChecking=no jams_peer -s sftp")
	if err != nil {
		peerSession.Close()
		return "", fmt.Errorf("error ejecutando salto a peer: %w", err)
	}

	peerSFTP, err := sftp.NewClientPipe(stdout, stdin)
	if err != nil {
		peerSession.Close()
		return "", fmt.Errorf("error negociando SFTP con peer: %w", err)
	}

	a.backupSFTP = a.sftpClient
	a.peerSession = peerSession
	a.peerSFTP = peerSFTP
	a.sftpClient = peerSFTP
	a.isPeer = true

	return "Conectado exitosamente al nodo Peer (jams_peer)", nil
}

// ========================================================
// MÉTODOS REMOTOS Y LOCALES
// ========================================================

func (a *App) ListRemote(path string) ([]RemoteFile, error) {
	if a.sftpClient == nil {
		return nil, fmt.Errorf("no hay conexión activa")
	}
	entries, err := a.sftpClient.ReadDir(path)
	if err != nil {
		return nil, err
	}
	var result []RemoteFile
	for _, e := range entries {
		result = append(result, RemoteFile{
			Name:    e.Name(),
			Size:    e.Size(),
			IsDir:   e.IsDir(),
			ModTime: e.ModTime().Format("2006-01-02 15:04"),
		})
	}
	return result, nil
}

func (a *App) GetLocalHome() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "C:\\", nil
	}
	return filepath.Clean(home), nil
}

func (a *App) ListLocal(dirPath string) ([]LocalFile, error) {
	cleanPath := filepath.Clean(dirPath)
	entries, err := os.ReadDir(cleanPath)
	if err != nil {
		return nil, fmt.Errorf("error leyendo dir local: %w", err)
	}
	var result []LocalFile
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		result = append(result, LocalFile{
			Name:    e.Name(),
			Size:    info.Size(),
			IsDir:   e.IsDir(),
			ModTime: info.ModTime().Format("2006-01-02 15:04"),
		})
	}
	return result, nil
}

func (a *App) DownloadFile(remotePath, localPath string) error {
	if a.sftpClient == nil {
		return fmt.Errorf("no hay conexión activa")
	}
	srcFile, err := a.sftpClient.Open(remotePath)
	if err != nil {
		return err
	}
	defer srcFile.Close()
	if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
		return err
	}
	dstFile, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer dstFile.Close()
	_, err = io.Copy(dstFile, srcFile)
	return err
}

func (a *App) UploadFile(localPath, remotePath string) error {
	if a.sftpClient == nil {
		return fmt.Errorf("no hay conexión activa")
	}
	srcFile, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer srcFile.Close()
	dstFile, err := a.sftpClient.Create(remotePath)
	if err != nil {
		return err
	}
	defer dstFile.Close()
	_, err = io.Copy(dstFile, srcFile)
	return err
}

// ========================================================
// INTEGRACIÓN CODELCO
// ========================================================

const (
	CodelcoPivotHost = "10.169.140.41"
	CodelcoPivotPort = 22
	CodelcoPivotUser = "jigsaw"
	CodelcoPivotPass = "Hxgn$2025"
	CodelcoCmd       = "/opt/maikdev/rmmConnectCodelco/rmmConnectGenerate >/dev/null 2>&1 && cat /opt/maikdev/rmmConnectCodelco/connections.txt"
)

func FetchCodelcoSites() ([]Site, error) {
	config := &ssh.ClientConfig{
		User: CodelcoPivotUser,
		Auth: []ssh.AuthMethod{
			ssh.Password(CodelcoPivotPass),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         8 * time.Second,
	}
	addr := fmt.Sprintf("%s:%d", CodelcoPivotHost, CodelcoPivotPort)
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return nil, fmt.Errorf("error conectando pivote: %w", err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("error abriendo sesión SSH: %w", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput(CodelcoCmd)
	if err != nil {
		return nil, fmt.Errorf("error sincronización: %w", err)
	}
	return parseCodelcoConnections(string(output))
}

func parseCodelcoConnections(rawOutput string) ([]Site, error) {
	var dynamicSites []Site
	lines := strings.Split(rawOutput, "\n")
	for _, rawLine := range lines {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		nombre := parts[0]
		var user, host, ip string
		var port int
		for _, field := range parts[1:] {
			kv := strings.SplitN(field, ":", 2)
			if len(kv) == 2 {
				switch kv[0] {
				case "user":
					user = kv[1]
				case "port":
					fmt.Sscanf(kv[1], "%d", &port)
				case "host":
					host = kv[1]
				case "ip":
					ip = kv[1]
				}
			}
		}
		if user == "" || port == 0 || host == "" {
			continue
		}
		displayName := fmt.Sprintf("[Codelco] %s (%s)", strings.TrimSuffix(strings.TrimPrefix(nombre, "Host_"), ".bt.ssh"), ip)
		hops := []Hop{
			{Name: "Pivote Codelco", Host: CodelcoPivotHost, Port: CodelcoPivotPort, User: CodelcoPivotUser, Password: CodelcoPivotPass},
			{Name: fmt.Sprintf("BeyondTrust %s", nombre), Host: host, Port: port, User: user, Password: "", UsePivotKey: false},
		}
		if strings.Contains(nombre, "dsal") || ip == "10.55.247.50" {
			hops = append(hops, Hop{Name: "Salvador Activo", Host: "10.55.55.6", Port: 22, User: "jigsaw", UsePivotKey: true})
		}
		dynamicSites = append(dynamicSites, Site{
			ID:     fmt.Sprintf("codelco_%s_%d", nombre, port),
			Nombre: displayName,
			Hops:   hops,
		})
	}
	return dynamicSites, nil
}

func (a *App) LoadDefaultSites() ([]Site, error) {
	data, err := os.ReadFile("sites.json")
	if err != nil {
		data = embeddedSitesJSON
	}
	var loaded []Site
	if err := json.Unmarshal(data, &loaded); err != nil {
		return nil, fmt.Errorf("error parseando sites.json: %w", err)
	}
	a.sites = loaded
	return a.sites, nil
}

func (a *App) RefreshCodelcoSites() ([]Site, error) {
	codelcoSites, err := FetchCodelcoSites()
	if err != nil {
		return nil, err
	}
	a.sites = codelcoSites
	return a.sites, nil
}
