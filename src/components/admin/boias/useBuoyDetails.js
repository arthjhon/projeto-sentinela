import { useCallback, useEffect, useRef, useState } from 'react';
import { manutencaoAberta, ultimasCalibracoes } from '../../../services/maintenance';

/**
 * Dados persistidos de UMA bóia (manutenção aberta e
 * última calibração por sensor). Vive dentro do detalhe expandido: ao fechar a
 * linha o estado some, e cada bóia tem o seu (nada vaza entre bóias).
 * `error` preenchido = leitura falhou: a UI mostra "indisponível", não "nenhum registro".
 */
export function useBuoyDetails(codigo) {
  const [dados, setDados] = useState({ aberta: undefined, calibracoes: null, error: null });
  const pedido = useRef(0);

  const recarregar = useCallback(async () => {
    const meu = ++pedido.current;
    try {
      const [aberta, calibracoes] = await Promise.all([manutencaoAberta(codigo), ultimasCalibracoes(codigo)]);
      if (meu === pedido.current) setDados({ aberta, calibracoes, error: null });
    } catch (err) {
      if (meu === pedido.current) setDados((d) => ({ ...d, error: err.message }));
    }
  }, [codigo]);

  useEffect(() => {
    recarregar();
    return () => { pedido.current += 1; };
  }, [recarregar]);

  return { ...dados, carregando: dados.calibracoes === null && dados.error === null, recarregar };
}
