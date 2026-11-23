import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { listarManutencoes, listarCalibracoes } from '../../../services/maintenance';
import { listarDeploysDaBoia } from '../../../services/otaCommand';
import { fetchHealthEventsDosSeriais, fetchSensorHealth } from '../../../services/sensorHealth';
import { listarAuditoriaDaEntidade } from '../../../services/auditLog';
import { deviceIdsOf } from '../../../services/buoyRegistry';
import {
  LIMITE_POR_FONTE, TIPOS, ACOES_CADASTRO, paraFonte, fonteInicial, manutencaoAbertaDaFonte, ultimoDeploySucessoDaFonte,
} from '../../../utils/fichaBoia';

const CHAVES = [...TIPOS, 'saudeAtual'];
const CARREGANDO = { estado: 'carregando' };

/**
 * Leituras persistidas da ficha da bóia, uma Fonte por tipo ({estado, linhas?, erro?}).
 * Cada fonte grava o próprio estado e descarta a resposta de um pedido superado
 * (contador por fonte). Falha de uma não afeta as outras. Quem usa deve renderizar
 * com `key={codigo}`: trocar de bóia reinicia o estado.
 *
 * @returns {{
 *   fontes: Record<'manutencao'|'calibracao'|'firmware'|'saude'|'cadastro', object>,
 *   saudeAtual: object,
 *   aberta: object|null|'erro'|undefined,
 *   ultimoDeploySucesso: {ok: true, valor: object|null}|{ok: false, erro: string}|undefined,
 *   recarregar: (chave: string) => void,
 * }}
 */
export function useFichaBoia(buoy, role) {
  const codigo = buoy.codigo;
  const seriaisKey = deviceIdsOf(buoy).join(',');
  const seriais = useMemo(() => (seriaisKey ? seriaisKey.split(',') : []), [seriaisKey]);

  const [estado, setEstado] = useState(() => ({
    ...Object.fromEntries(TIPOS.map((t) => [t, fonteInicial(t, role)])),
    saudeAtual: CARREGANDO,
  }));
  const pedidos = useRef({});

  const leitor = useCallback((chave) => {
    switch (chave) {
      case 'manutencao': return () => listarManutencoes(codigo, LIMITE_POR_FONTE);
      case 'calibracao': return () => listarCalibracoes(codigo, LIMITE_POR_FONTE);
      case 'firmware': return () => listarDeploysDaBoia(supabase, codigo, LIMITE_POR_FONTE);
      case 'saude': return () => fetchHealthEventsDosSeriais(seriais, LIMITE_POR_FONTE);
      case 'cadastro': return () => listarAuditoriaDaEntidade(codigo, ACOES_CADASTRO, LIMITE_POR_FONTE);
      default: return () => fetchSensorHealth();
    }
  }, [codigo, seriais]);

  const carregar = useCallback(async (chave, { marcar }) => {
    // Cadastro sem acesso é decidido pelo perfil: nunca consulta audit_logs.
    if (chave === 'cadastro' && fonteInicial('cadastro', role).estado === 'sem-acesso') return;
    const pedido = (pedidos.current[chave] ?? 0) + 1;
    pedidos.current[chave] = pedido;
    if (marcar) setEstado((e) => ({ ...e, [chave]: CARREGANDO }));
    const fonte = await paraFonte(leitor(chave)());
    if (pedidos.current[chave] !== pedido) return; // superado (ou desmontado)
    setEstado((e) => ({ ...e, [chave]: fonte }));
  }, [leitor, role]);

  const primeira = useRef(true);
  useEffect(() => {
    const atuais = pedidos.current;
    // Primeira montagem: o estado inicial já é "carregando". Depois, uma troca de código/seriais marca de novo.
    const marcar = !primeira.current;
    primeira.current = false;
    CHAVES.forEach((chave) => { carregar(chave, { marcar }); });
    return () => { CHAVES.forEach((chave) => { atuais[chave] = (atuais[chave] ?? 0) + 1; }); };
  }, [carregar]);

  const recarregar = useCallback((chave) => {
    if (CHAVES.includes(chave)) carregar(chave, { marcar: true });
  }, [carregar]);

  const { saudeAtual, ...fontes } = estado;
  const aberta = manutencaoAbertaDaFonte(fontes.manutencao);
  const ultimoDeploySucesso = ultimoDeploySucessoDaFonte(fontes.firmware);

  return { fontes, saudeAtual, aberta, ultimoDeploySucesso, recarregar };
}
