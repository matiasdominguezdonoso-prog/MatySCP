import React, { useState, useEffect } from 'react';
import {
  GetSites,
  ConnectSite,
  Disconnect,
  ListRemote,
  ListLocal,
  GetLocalHome,
  DownloadFile,
  UploadFile,
  RefreshCodelcoSites,
  LoadDefaultSites, // <-- Importamos la nueva función
  TogglePeer,
  IsPeer,
  GetConnectionInfo
} from '../wailsjs/go/main/App';
import './App.css';

function App() {
  const [sites, setSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Listo');
  const [busy, setBusy] = useState(false);
  const [isPeer, setIsPeer] = useState(false);
  
  // NUEVO: Estado para guardar la IP actual
  const [currentIp, setCurrentIp] = useState('');

  const [localPath, setLocalPath] = useState('');
  const [localFiles, setLocalFiles] = useState([]);
  const [selectedLocal, setSelectedLocal] = useState(null);

  const [remotePath, setRemotePath] = useState('/home/jigsaw');
  const [remoteFiles, setRemoteFiles] = useState([]);
  const [selectedRemote, setSelectedRemote] = useState(null);

  useEffect(() => {
    GetSites().then((data) => {
      if (data && data.length > 0) {
        setSites(data);
        setSelectedSite(data[0].id);
      }
    }).catch((err) => setStatus(`Error cargando sitios: ${err}`));

    GetLocalHome().then((home) => {
      setLocalPath(home);
      loadLocal(home);
    }).catch(() => {
      setLocalPath('C:\\');
      loadLocal('C:\\');
    });
  }, []);

  const loadLocal = async (targetPath) => {
    try {
      const list = await ListLocal(targetPath);
      const sorted = (list || []).sort((a, b) => {
        if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
        return a.is_dir ? -1 : 1;
      });
      setLocalFiles(sorted);
      setLocalPath(targetPath);
      setSelectedLocal(null);
    } catch (err) {
      setStatus(`Error local: ${err}`);
    }
  };

  const loadRemote = async (targetPath) => {
    try {
      const list = await ListRemote(targetPath);
      const sorted = (list || []).sort((a, b) => {
        if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
        return a.is_dir ? -1 : 1;
      });
      setRemoteFiles(sorted);
      setRemotePath(targetPath);
      setSelectedRemote(null);
    } catch (err) {
      setStatus(`Error remoto: ${err}`);
    }
  };

  const handleConnect = async () => {
    if (!selectedSite) return;
    setBusy(true);
    setStatus('Conectando saltos SSH...');
    try {
      const msg = await ConnectSite(selectedSite);
      
      // PEDIMOS LA INFO REAL
      const info = await GetConnectionInfo();
      setCurrentIp(`${info.ip} - Host: ${info.hostname}`);
      
      setStatus(msg);
      setConnected(true);
      setIsPeer(false);
      await loadRemote(remotePath);
    } catch (err) {
      setStatus(`Error de conexión: ${err}`);
      setConnected(false);
      setCurrentIp('');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await Disconnect();
      setConnected(false);
      setIsPeer(false);
      setCurrentIp('');
      setRemoteFiles([]);
      setSelectedRemote(null);
      setStatus('Desconectado');
    } catch (err) {
      console.error(err);
    }
  };

  // NUEVO: Función para recargar faenas estáticas
  const handleLoadDefaults = async () => {
    setBusy(true);
    setStatus('Cargando faenas normales...');
    try {
      const defaultSites = await LoadDefaultSites();
      setSites(defaultSites);
      if (defaultSites && defaultSites.length > 0) setSelectedSite(defaultSites[0].id);
      setStatus('Faenas locales cargadas');
    } catch (err) {
      setStatus(`Error cargando locales: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSyncCodelco = async () => {
    setBusy(true);
    setStatus('Sincronizando faenas activas de Codelco...');
    try {
      const updatedSites = await RefreshCodelcoSites();
      setSites(updatedSites);
      if (updatedSites && updatedSites.length > 0) setSelectedSite(updatedSites[0].id);
      setStatus('Faenas de Codelco exclusivas sincronizadas');
    } catch (err) {
      setStatus(`Error sincronizando Codelco: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePeer = async () => {
    setBusy(true);
    setStatus('Conmutando nodo...');
    try {
      const msg = await TogglePeer();
      const current = await IsPeer();
      setIsPeer(current);
      setStatus(msg);
      
      // ACTUALIZAR IP EN LA INTERFAZ
      if (current) {
        setCurrentIp('jams_peer (Activo)');
      } else {
        const site = sites.find(s => s.id === selectedSite);
        if (site && site.hops && site.hops.length > 0) {
          setCurrentIp(site.hops[site.hops.length - 1].host);
        }
      }

      await loadRemote(remotePath);
    } catch (err) {
      setStatus(`Error al alternar peer: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    if (!selectedRemote || selectedRemote.is_dir) return;
    setBusy(true);
    setStatus(`Descargando ${selectedRemote.name}...`);
    const sep = localPath.endsWith('\\') || localPath.endsWith('/') ? '' : '\\';
    const localDest = `${localPath}${sep}${selectedRemote.name}`;
    const remoteSrc = remotePath.endsWith('/') ? `${remotePath}${selectedRemote.name}` : `${remotePath}/${selectedRemote.name}`;

    try {
      await DownloadFile(remoteSrc, localDest);
      setStatus(`Descarga completada: ${selectedRemote.name}`);
      await loadLocal(localPath);
    } catch (err) {
      setStatus(`Fallo en descarga: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedLocal || selectedLocal.is_dir) return;
    setBusy(true);
    setStatus(`Subiendo ${selectedLocal.name}...`);
    const sep = localPath.endsWith('\\') || localPath.endsWith('/') ? '' : '\\';
    const localSrc = `${localPath}${sep}${selectedLocal.name}`;
    const remoteDest = remotePath.endsWith('/') ? `${remotePath}${selectedLocal.name}` : `${remotePath}/${selectedLocal.name}`;

    try {
      await UploadFile(localSrc, remoteDest);
      setStatus(`Subida completada: ${selectedLocal.name}`);
      await loadRemote(remotePath);
    } catch (err) {
      setStatus(`Fallo en subida: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="app-container">
      <header className="topbar">
        <div className="brand">
          <h2>MatySCP</h2>
          <span className="badge">v0.3</span>
        </div>

        <div className="controls">
          <label>Faena:</label>
          <select 
            value={selectedSite} 
            onChange={(e) => setSelectedSite(e.target.value)}
            disabled={connected || busy}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>

          {/* Botón Restaurar Faenas Base */}
          <button 
            className="btn-nav" 
            title="Cargar catálogo normal (sites.json)"
            onClick={handleLoadDefaults} 
            disabled={connected || busy}
          >
            📂 Normales
          </button>

          {/* Botón Codelco */}
          <button 
            className="btn-nav" 
            title="Escanear sesiones activas de BeyondTrust"
            onClick={handleSyncCodelco} 
            disabled={connected || busy}
          >
            🔄 Codelco
          </button>

          {connected && (
            <button 
              className={`btn-peer ${isPeer ? 'active-node' : 'backup-node'}`}
              onClick={handleTogglePeer}
              disabled={busy}
              title="Saltar hacia el servidor hermano (Peer)"
            >
              {isPeer ? '⬅ Volver al nodo inicial' : '🔁 Saltar a Peer'}
            </button>
          )}

          {!connected ? (
            <button className="btn-connect" onClick={handleConnect} disabled={busy}>
              {busy ? 'Conectando...' : 'Conectar'}
            </button>
          ) : (
            <button className="btn-disconnect" onClick={handleDisconnect} disabled={busy}>
              Desconectar
            </button>
          )}
        </div>
      </header>

      {/* Barra de Estado con IP Dinámica */}
      <div className={`status-bar ${connected ? 'online' : 'offline'}`} style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{status}</span>
        {connected && (
          <span style={{ fontWeight: 'bold', color: '#00d2df' }}>
            🌐 Conectado a: {currentIp}
          </span>
        )}
      </div>

      <main className="panes-container">
        <section className="pane">
          <div className="pane-header">
            <span className="pane-title">💻 Mi PC (Local)</span>
          </div>

          <div className="path-bar">
            <button className="btn-nav" onClick={() => {
              const clean = localPath.replace(/[/\\]+$/, '');
              const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
              if (lastSlash > 0) loadLocal(clean.substring(0, lastSlash));
              else if (lastSlash === 0 || clean.endsWith(':')) loadLocal(clean.substring(0, lastSlash + 1) || clean);
            }} disabled={busy}>⬆</button>
            <input 
              type="text" 
              value={localPath} 
              onChange={(e) => setLocalPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadLocal(localPath)}
              disabled={busy}
            />
            <button className="btn-nav" onClick={() => loadLocal(localPath)} disabled={busy}>🔄</button>
          </div>

          <div className="file-list-container">
            <table className="file-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th style={{ width: '80px' }}>Tamaño</th>
                  <th style={{ width: '130px' }}>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {localFiles.map((file, idx) => (
                  <tr 
                    key={idx} 
                    className={`${file.is_dir ? 'row-folder' : 'row-file'} ${selectedLocal?.name === file.name ? 'selected' : ''}`}
                    onClick={() => setSelectedLocal(file)}
                    onDoubleClick={() => {
                      if (file.is_dir && !busy) {
                        const sep = localPath.endsWith('\\') || localPath.endsWith('/') ? '' : '\\';
                        loadLocal(`${localPath}${sep}${file.name}`);
                      }
                    }}
                  >
                    <td>
                      <span className="icon">{file.is_dir ? '📁' : '📄'}</span>
                      <span className="file-name">{file.name}</span>
                    </td>
                    <td>{file.is_dir ? '-' : formatSize(file.size)}</td>
                    <td>{file.mod_time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="transfer-toolbar">
          <button 
            className="btn-transfer" 
            onClick={handleUpload}
            disabled={!connected || !selectedLocal || selectedLocal.is_dir || busy}
          >
            Subir ➔
          </button>
          <button 
            className="btn-transfer" 
            onClick={handleDownload}
            disabled={!connected || !selectedRemote || selectedRemote.is_dir || busy}
          >
            ⬅ Descargar
          </button>
        </div>

        <section className="pane">
          <div className="pane-header">
            <span className="pane-title">⛏ Servidor Faena</span>
          </div>

          <div className="path-bar">
            <button className="btn-nav" onClick={() => {
              if (remotePath === '/' || remotePath === '') return;
              const parts = remotePath.split('/').filter(Boolean);
              parts.pop();
              loadRemote('/' + parts.join('/'));
            }} disabled={!connected || busy}>⬆</button>
            <input 
              type="text" 
              value={remotePath} 
              disabled={!connected || busy}
              onChange={(e) => setRemotePath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadRemote(remotePath)}
            />
            <button className="btn-nav" onClick={() => loadRemote(remotePath)} disabled={!connected || busy}>🔄</button>
          </div>

          <div className="file-list-container">
            {connected ? (
              <table className="file-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th style={{ width: '80px' }}>Tamaño</th>
                    <th style={{ width: '130px' }}>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {remoteFiles.map((file, idx) => (
                    <tr 
                      key={idx} 
                      className={`${file.is_dir ? 'row-folder' : 'row-file'} ${selectedRemote?.name === file.name ? 'selected' : ''}`}
                      onClick={() => setSelectedRemote(file)}
                      onDoubleClick={() => {
                        if (file.is_dir && !busy) {
                          const sep = remotePath.endsWith('/') ? '' : '/';
                          loadRemote(`${remotePath}${sep}${file.name}`);
                        }
                      }}
                    >
                      <td>
                        <span className="icon">{file.is_dir ? '📁' : '📄'}</span>
                        <span className="file-name">{file.name}</span>
                      </td>
                      <td>{file.is_dir ? '-' : formatSize(file.size)}</td>
                      <td>{file.mod_time}</td>
                    </tr>
                  ))}
                  {remoteFiles.length === 0 && (
                    <tr><td colSpan="3" className="empty-msg">Directorio vacío</td></tr>
                  )}
                </tbody>
              </table>
            ) : (
              <div className="empty-placeholder">
                <p>Conéctate a una faena para ver los archivos remotos.</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;