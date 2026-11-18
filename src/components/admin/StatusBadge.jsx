import React from 'react';
import { Link } from 'react-router-dom';
import { useSystemStatus } from '../../contexts/SystemStatusContext';
import { BADGE_META } from '../../services/systemStatus';

const StatusBadge = () => {
  const { badge } = useSystemStatus();
  const meta = BADGE_META[badge] ?? BADGE_META.verificando;
  return (
    <Link
      to="/admin/status"
      className={`header-status header-status--${meta.tone}`}
      title="Ver status do sistema"
    >
      <span className={`status-dot ${meta.tone}`}></span>
      {meta.label}
    </Link>
  );
};

export default StatusBadge;
