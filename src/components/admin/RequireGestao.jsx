import React from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ehPerfilGestao } from '../../config/adminNav';
import AcessoNegado from './AcessoNegado';

/**
 * Guarda de rota das telas de gestão (Firmware, Configurações). Layout route:
 * renderiza o <Outlet/> só para quem passa em `permitido(role)`; senão mostra
 * "Acesso Negado" sem montar a página (nenhum hook/fetch dela roda). Falha
 * fechada: perfil ausente ou desconhecido não passa.
 *
 * @param {object} props
 * @param {(role: string|undefined) => boolean} [props.permitido=ehPerfilGestao]  critério por perfil
 * @param {string} [props.mensagem]  complemento do aviso
 */
export default function RequireGestao({
  permitido = ehPerfilGestao,
  mensagem = 'Você não possui privilégios de Administrador para acessar esta área.',
}) {
  const { currentUser } = useAuth();
  if (!permitido(currentUser?.role)) return <AcessoNegado>{mensagem}</AcessoNegado>;
  return <Outlet />;
}
