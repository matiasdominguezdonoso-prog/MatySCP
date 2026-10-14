package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type Hop struct {
	Name        string `json:"name"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	User        string `json:"user"`
	Password    string `json:"password,omitempty"`
	UsePivotKey bool   `json:"use_pivot_key,omitempty"` // true para usar id_rsa del salto previo
}

type TunnelSession struct {
	SFTPClient *sftp.Client
	SSHClient  *ssh.Client

	RealIP   string
	Hostname string
}

func (s *TunnelSession) Close() {
	if s.SFTPClient != nil {
		s.SFTPClient.Close()
	}
	if s.SSHClient != nil {
		s.SSHClient.Close()
	}
}

func ConnectChain(hops []Hop) (*TunnelSession, error) {
	if len(hops) == 0 {
		return nil, fmt.Errorf("no hay saltos configurados")
	}

	var currentClient *ssh.Client

	for i, hop := range hops {
		targetAddr := fmt.Sprintf("%s:%d", hop.Host, hop.Port)
		var authMethods []ssh.AuthMethod

		if hop.UsePivotKey {
			// Caso 1: Salto con llave privada id_rsa del pivote anterior (ej: Zaldívar)
			if currentClient == nil {
				return nil, fmt.Errorf("el salto 1 no puede depender de una llave de pivote previo")
			}

			sess, err := currentClient.NewSession()
			if err != nil {
				return nil, fmt.Errorf("error abriendo sesión para leer llave en pivote: %w", err)
			}
			keyBytes, err := sess.Output("cat ~/.ssh/id_rsa")
			sess.Close()
			if err != nil {
				return nil, fmt.Errorf("no se pudo leer ~/.ssh/id_rsa en el pivote: %w", err)
			}

			signer, err := ssh.ParsePrivateKey(keyBytes)
			if err != nil {
				return nil, fmt.Errorf("error interpretando llave privada del pivote: %w", err)
			}

			authMethods = append(authMethods, ssh.PublicKeys(signer))
		} else if hop.Password != "" {
			// Caso 2: Autenticación tradicional por contraseña
			authMethods = append(authMethods, ssh.Password(hop.Password))
		} else {
			// Caso 3: Autenticación sin contraseña o tokens efímeros (ej: BeyondTrust / Codelco)
			authMethods = append(authMethods, ssh.Password(""))
			authMethods = append(authMethods, ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for idx := range answers {
					answers[idx] = ""
				}
				return answers, nil
			}))
		}

		sshConfig := &ssh.ClientConfig{
			User:            hop.User,
			Auth:            authMethods,
			HostKeyCallback: ssh.InsecureIgnoreHostKey(),
			Timeout:         8 * time.Second,
		}

		if i == 0 {
			// Salto inicial directo desde la máquina local
			client, err := ssh.Dial("tcp", targetAddr, sshConfig)
			if err != nil {
				return nil, fmt.Errorf("error en salto 1 [%s]: %w", targetAddr, err)
			}
			currentClient = client
		} else {
			// Saltos intermedios a través del túnel TCP previo
			conn, err := currentClient.Dial("tcp", targetAddr)
			if err != nil {
				return nil, fmt.Errorf("error abriendo canal TCP a salto %d [%s]: %w", i+1, targetAddr, err)
			}

			ncc, chans, reqs, err := ssh.NewClientConn(conn, targetAddr, sshConfig)
			if err != nil {
				conn.Close()
				return nil, fmt.Errorf("error autenticando SSH en salto %d [%s]: %w", i+1, targetAddr, err)
			}
			currentClient = ssh.NewClient(ncc, chans, reqs)
		}
	}

	// 1. Extraer la IP real de red
	realIP := currentClient.RemoteAddr().String()

	// 2. Extraer el Hostname real ejecutando un comando rápido
	var hostnameStr string
	sessInfo, err := currentClient.NewSession()
	if err == nil {
		out, err := sessInfo.Output("hostname")
		if err == nil {
			hostnameStr = strings.TrimSpace(string(out))
		}
		sessInfo.Close()
	}

	// Inicializar SFTP en el host de destino final
	sftpCli, err := sftp.NewClient(currentClient)
	if err != nil {
		currentClient.Close()
		return nil, fmt.Errorf("error iniciando SFTP final: %w", err)
	}

	return &TunnelSession{
		SFTPClient: sftpCli,
		SSHClient:  currentClient,
		RealIP:     realIP,
		Hostname:   hostnameStr,
	}, nil
}
