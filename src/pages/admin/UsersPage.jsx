import React, { useState } from 'react';
import { useAuth } from './../../contexts/AuthContext';
import { useToast } from './../../contexts/ToastContext';
import ConfirmModal from './../../components/ConfirmModal';
import { Search, Plus, Edit2, Trash2, Shield, User, Eye, KeyRound, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import './UsersPage.css';

const UsersPage = () => {
  const { users, currentUser, createAdminUser, deleteAdminUser, editAdminUser } = useAuth();
  const { addToast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  
  // Custom Flow states
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [passwordType, setPasswordType] = useState('random');

  // Confirmation state
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);

  // Validation State
  const [formErrors, setFormErrors] = useState({});

  const initialFormData = {
    name: '',
    username: '',
    password: '',
    role: 'operador', // 'admin', 'operador', 'visualizador'
  };
  const [formData, setFormData] = useState(initialFormData);

  if (currentUser?.role !== 'admin') {
    return (
      <div className="dashboard-content-area">
        <div className="alert-permission glass mt-4">
          <Shield size={32} className="text-danger mb-3" />
          <h2>Acesso Negado</h2>
          <p>Você não possui privilégios de Administrador para gerenciar a base de dados de operadores.</p>
        </div>
      </div>
    );
  }

  const handleOpenCreate = () => {
    setEditingUser(null);
    setFormData(initialFormData);
    setGeneratedPassword('');
    setPasswordType('random');
    setFormErrors({});
    setIsModalOpen(true);
  };

  const handleOpenEdit = (user) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      username: user.username,
      password: '', // We don't read passwords. Form represents "new password override" if filled
      role: user.role
    });
    setGeneratedPassword('');
    setPasswordType('random');
    setFormErrors({});
    setIsModalOpen(true);
  };

  const generateRandomStr = () => {
    return Math.random().toString(36).slice(-6).toUpperCase();
  };

  const handleResetGenerate = (e) => {
    e.preventDefault();
    const newPass = generateRandomStr();
    setGeneratedPassword(newPass);
    setFormData({ ...formData, password: newPass });
  };

  const requestDelete = (id) => {
    if (id === currentUser.id) {
      addToast("Segurança: Você não pode deletar o próprio usuário logado.", "error");
      return;
    }
    setUserToDelete(id);
    setConfirmDeleteOpen(true);
  };

  const confirmDeleteAction = async () => {
    const res = await deleteAdminUser(userToDelete);
    if(res.success) {
      addToast("Operador permanentemente excluído da Nuvem.", "success");
    } else {
      addToast("Falha ao excluir: " + res.error, "error");
    }
    setConfirmDeleteOpen(false);
    setUserToDelete(null);
  };

  const handleSaveForm = async (e) => {
    e.preventDefault();

    // Custom Validation
    const errors = {};
    if (!formData.name.trim()) errors.name = true;
    if (!formData.username.trim()) errors.username = true;
    if (passwordType === 'manual' && !formData.password.trim() && !editingUser) errors.password = true;

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      addToast("Preencha todos os campos destacados em vermelho.", "error");
      return;
    }

    // Senha provisória mandatory flag
    let passToSave = formData.password;
    if (passwordType === 'random' && !editingUser && !generatedPassword) {
       passToSave = generateRandomStr();
    } else if (passwordType === 'random' && generatedPassword) {
       passToSave = generatedPassword;
    }

    if (editingUser) {
      // Edit Flow
      const nameCheck = users.find(u => u.username === formData.username && u.id !== editingUser.id);
      if(nameCheck) { addToast("Esse nome de login já existe no sistema!", "warning"); return; }

      const res = await editAdminUser(editingUser.id, {
        name: formData.name,
        role: formData.role
      });
      
      if(res.success) {
        addToast("Operador atualizado com sucesso na Nuvem.", "success");
      } else {
        addToast("Erro na Nuvem: " + res.error, "error");
      }

    } else {
      // Create Flow
      const nameCheck = users.find(u => u.username === formData.username);
      if(nameCheck) { addToast("Nome de usuário indísponivel. Escolha outro.", "warning"); return; }

      if(!passToSave) { addToast("Defina ou gere uma senha para prosseguir.", "error"); return; }

      const res = await createAdminUser(formData, passToSave);
      
      if(res.success) {
        if (passwordType === 'random' || generatedPassword) {
            addToast("Conta Criada na Nuvem! Copie a senha provisória e repasse.", "password", passToSave, false);
        } else {
            addToast("Conta Criada! O usuário já pode logar.", "success");
        }
      } else {
        addToast("Erro do Servidor Supabase: " + res.error, "error");
      }
    }

    setIsModalOpen(false);
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="dashboard-content-area">
      <div className="page-header d-flex-between">
        <div>
          <h1>Controle de Operadores e Perfil</h1>
          <p>Supervisão segura das contas com acesso local à Plataforma Sentinela.</p>
        </div>
        
        <div className="header-actions">
          <div className="search-bar glass">
            <Search size={18} className="text-muted" />
            <input 
              type="text" 
              placeholder="Buscar operador..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={handleOpenCreate}>
            <Plus size={18} /> Novo Usuário
          </button>
        </div>
      </div>

      <div className="users-list-wrapper glass mt-4">
        <table className="users-table">
          <thead>
            <tr>
              <th>Nome Completo</th>
              <th>Credencial (Login)</th>
              <th>Nível de Acesso</th>
              <th>Status Segurança</th>
              <th className="text-right">Ações de Admin</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(user => (
              <tr key={user.id} className="user-row">
                <td>
                  <div className="user-cell-name">
                    <div className={`avatar-mini ${user.role}`}>
                      {user.role === 'admin' ? <Shield size={16}/> : user.role === 'operador' ? <User size={16}/> : <Eye size={16}/>}
                    </div>
                    <span className="font-medium">{user.name}</span>
                  </div>
                </td>
                <td className="monospace">{user.username}</td>
                <td>
                  <span className={`role-badge ${user.role}`}>
                    {user.role.toUpperCase()}
                  </span>
                </td>
                <td>
                  {user.must_change_password ? (
                    <span className="alert-badge warning"><KeyRound size={14}/> Mudança Pendente</span>
                  ) : (
                    <span className="alert-badge success">Protegido V2</span>
                  )}
                </td>
                <td className="actions-cell">
                  <button className="btn-table action-btn" onClick={() => handleOpenEdit(user)}>
                    <Edit2 size={16} />
                  </button>
                  <button className="btn-table action-btn danger-btn" onClick={() => requestDelete(user.id)} disabled={user.id === currentUser.id} title={user.id === currentUser.id ? 'Você não pode apagar sua própria conta' : 'Apagar'}>
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && createPortal(
        <div className="crud-modal-overlay">
          <div className="crud-modal animate-fade-in" style={{maxWidth: '500px'}}>
            <div className="crud-modal-header">
              <h3>{editingUser ? 'Editar Acessos do Operador' : 'Expedir Nova Credencial'}</h3>
              <button className="btn-close" onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSaveForm} className="crud-modal-body" noValidate>
              <div className="form-group">
                <label>Nome Completo do Funcionário</label>
                <input type="text" className={`w-100 ${formErrors.name ? 'input-error' : ''}`} value={formData.name} onChange={e => {setFormData({...formData, name: e.target.value}); setFormErrors({...formErrors, name: false})}} placeholder="Ex: Arthur Lima" />
              </div>
              
              <div className="form-group mt-2">
                <label>Credencial de Login (Usuário)</label>
                <input type="text" className={`w-100 ${formErrors.username ? 'input-error' : ''}`} value={formData.username} onChange={e => {setFormData({...formData, username: e.target.value.toLowerCase().replace(/\s/g, '')}); setFormErrors({...formErrors, username: false})}} placeholder="Ex: arthur.lima" />
              </div>

              <div className="form-group mt-2">
                <label>Nível Sistêmico de Acesso</label>
                <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
                  <option value="admin">Administrador (Total / CRUD Bóias e Usuários)</option>
                  <option value="operador">Operador (Acesso aos Sensores e Testes Manuais)</option>
                  <option value="visualizador">Visualizador (Somente Leitura de Painéis e Gráficos)</option>
                </select>
              </div>

              <div className="password-strategy-panel rounded mt-3">
                <h4 className="mb-2">{editingUser ? 'Reset Físico de Senha Provisória' : 'Senha Provisória'}</h4>
                <div className="radio-group mb-2">
                  <label><input type="radio" name="ptype" checked={passwordType === 'random'} onChange={() => setPasswordType('random')}/> Aleatória (Base 64)</label>
                  <label><input type="radio" name="ptype" checked={passwordType === 'manual'} onChange={() => setPasswordType('manual')}/> Digitar Manualmente</label>
                </div>
                
                {passwordType === 'random' ? (
                   <div className="d-flex mt-2" style={{gap:'1rem', alignItems:'center'}}>
                      <button className="btn-table action-btn" type="button" onClick={handleResetGenerate} style={{flexShrink: 0}}>
                        Gerar Código Único
                      </button>
                      <input type="text" className="w-100 font-monospace text-center" style={{padding:'0.6rem', background:'rgba(0,0,0,0.5)', border:'1px solid rgba(0,240,255,0.3)', borderRadius:'6px', color:'var(--success)', letterSpacing:'2px'}} readOnly value={generatedPassword || '######'} placeholder="Clique para gerar" />
                   </div>
                ) : (
                  <div className="form-group mt-2">
                    <input type="text" className={`w-100 ${formErrors.password ? 'input-error' : ''}`} value={formData.password} onChange={e => {setFormData({...formData, password: e.target.value}); setFormErrors({...formErrors, password: false})}} placeholder="Escreva uma senha simples (ex: sentinela123)..." />
                  </div>
                )}
                {editingUser && <p className="text-muted mt-2" style={{fontSize: '0.8rem'}}>Deixe o form de senha em branco se deseja apenas mudar nome/nível do usuário.</p>}
              </div>

              <div className="crud-modal-footer mt-4">
                <button type="button" className="btn-table" onClick={() => setIsModalOpen(false)}>Cancelar Operação</button>
                <button type="submit" className="btn-primary">
                  {editingUser ? 'Atualizar Entidade' : 'Ativar e Autorizar Conta'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      <ConfirmModal 
        isOpen={confirmDeleteOpen}
        title="Expurgar Operador"
        text="Aviso Crítico: Tem certeza de que deseja apagar permanentemente esse usuário? O acesso dele será revogado em tempo real."
        confirmText="Sim, Expurgar Perfil"
        onConfirm={confirmDeleteAction}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

    </div>
  );
};

export default UsersPage;
