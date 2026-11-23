import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { LogOut, Eye, Menu } from 'lucide-react';
import { navParaPerfil, tituloDaRota } from '../../config/adminNav';
import { SystemStatusProvider } from '../../contexts/SystemStatusContext';
import { menuInerte, focoDoMenu } from '../../utils/menuMobile';
import StatusBadge from '../../components/admin/StatusBadge';
import '../../styles/admin-shared.css';
import '../../components/admin/Modal.css';
import './AdminLayout.css';

const MQ_MOBILE = '(max-width: 768px)';
const subscribeMobile = (cb) => {
  const mq = window.matchMedia(MQ_MOBILE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const getMobile = () => window.matchMedia(MQ_MOBILE).matches;

const AdminLayout = () => {
  const mobile = useSyncExternalStore(subscribeMobile, getMobile, () => false);
  const sidebarRef = useRef(null);
  const toggleRef = useRef(null);
  const abertoAntesRef = useRef(false);
  const { logout, currentUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Menu no celular (<= 768 px). Fecha em qualquer navegação: cada push,
  // replace ou "voltar" traz uma location.key nova (ajuste durante o render,
  // sem efeito). Comparar o pathname reabria o menu ao voltar para a rota em
  // que ele foi aberto.
  const [menuAberto, setMenuAberto] = useState(false);
  const [keyVista, setKeyVista] = useState(location.key);
  if (location.key !== keyVista) {
    setKeyVista(location.key);
    setMenuAberto(false);
  }
  const fecharMenu = () => setMenuAberto(false);

  useEffect(() => {
    if (!menuAberto) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuAberto(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuAberto]);

  // Foco: ao abrir vai ao primeiro link; ao fechar volta ao botão. Fechar por
  // navegação também devolve o foco ao botão (o link clicado ficou inerte).
  useEffect(() => {
    const alvo = focoDoMenu({ mobile, aberto: menuAberto, jaAbriu: abertoAntesRef.current });
    abertoAntesRef.current = menuAberto;
    if (alvo === 'primeiro-link') sidebarRef.current?.querySelector('a')?.focus();
    else if (alvo === 'botao') toggleRef.current?.focus();
  }, [menuAberto, mobile]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <SystemStatusProvider>
      <div className="admin-container">
        <div className="bg-gradient-main"></div>

        {menuAberto && (
          <div className="admin-sidebar-backdrop" onClick={fecharMenu} aria-hidden="true" />
        )}

        <aside
          id="admin-sidebar"
          ref={sidebarRef}
          inert={menuInerte({ mobile, aberto: menuAberto })}
          className={`admin-sidebar glass ${menuAberto ? 'open' : ''}`}
        >
          <div className="sidebar-header">
            <div className="admin-logo">
              <img src="/sentinela-escudo.svg" alt="Sentinela" className="sidebar-logo-img" />
              <span>Sentinela</span>
            </div>
          </div>

          <nav className="sidebar-nav" aria-label="Menu do painel">
            {navParaPerfil(currentUser?.role).map((secao) => (
              <div key={secao.titulo} className="nav-section">
                <p className="nav-section-title">{secao.titulo}</p>
                {secao.itens.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/admin/dashboard'}
                      onClick={fecharMenu}
                      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    >
                      <Icon size={18} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="sidebar-footer">
            <div className="user-profile">
              <div className="avatar">{currentUser?.name?.charAt(0)?.toUpperCase() || 'U'}</div>
              <div className="user-info">
                <span className="user-name">{currentUser?.name || 'Usuário'}</span>
                <span className="user-role" style={{textTransform: 'capitalize'}}>{currentUser?.role || 'Visitante'}</span>
              </div>
            </div>
            <button onClick={handleLogout} className="logout-btn">
              <LogOut size={18} />
              Sair
            </button>
          </div>
        </aside>

        <main className="admin-main">
          <header className="admin-header glass">
            <button
              type="button"
              ref={toggleRef}
              className="menu-toggle"
              aria-label="Abrir menu"
              aria-expanded={menuAberto}
              aria-controls="admin-sidebar"
              onClick={() => setMenuAberto((aberto) => !aberto)}
            >
              <Menu size={22} />
            </button>
            {/* O único <h1> do painel: as páginas não repetem o título */}
            <h1>{tituloDaRota(location.pathname, currentUser?.role)}</h1>
            <div className="admin-header-status">
              {currentUser?.role === 'visualizador' && (
                <span className="badge badge-warning" title="Modo Demonstração — Somente Leitura">
                  <Eye size={14} aria-hidden="true" />
                  <span className="badge-demo-longo">Modo Demonstração — Somente Leitura</span>
                  <span className="badge-demo-curto">Demo</span>
                </span>
              )}
              <StatusBadge />
            </div>
          </header>

          <div className="admin-content animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </SystemStatusProvider>
  );
};

export default AdminLayout;
