import { describe, it, expect } from 'vitest';
import {
  mascararOperadores,
  contarAdmins,
  validarMudancaRole,
  validarExclusao,
  criarGuardaEnvio,
  descricaoOperador,
} from './usersRules.js';

const users = [
  { id: 'a1', name: 'Ana', username: 'ana', role: 'admin', must_change_password: false },
  { id: 'a2', name: 'Beto', username: 'beto', role: 'admin', must_change_password: true },
  { id: 'o1', name: 'Caio', username: 'caio', role: 'operador', must_change_password: false },
];

describe('mascararOperadores', () => {
  it('admin sees everything', () => {
    expect(mascararOperadores(users, 'admin')).toEqual(users);
  });

  it('visualizador keeps only id, name and role', () => {
    const out = mascararOperadores(users, 'visualizador');
    expect(out).toHaveLength(3);
    for (const u of out) expect(Object.keys(u).sort()).toEqual(['id', 'name', 'role']);
    expect(out[0]).toEqual({ id: 'a1', name: 'Ana', role: 'admin' });
  });

  it('fails closed for operador, unknown or missing role', () => {
    for (const role of ['operador', 'x', undefined]) {
      for (const u of mascararOperadores(users, role)) {
        expect(u).not.toHaveProperty('username');
        expect(u).not.toHaveProperty('must_change_password');
      }
    }
  });
});

describe('contarAdmins', () => {
  it('counts role admin only', () => {
    expect(contarAdmins(users)).toBe(2);
    expect(contarAdmins([])).toBe(0);
  });
});

describe('validarMudancaRole', () => {
  it('blocks changing your own role', () => {
    const r = validarMudancaRole({ alvoId: 'a1', novaRole: 'operador', usuarioAtualId: 'a1', users });
    expect(r.ok).toBe(false);
  });

  it('allows keeping the same role on yourself (name-only edit)', () => {
    expect(validarMudancaRole({ alvoId: 'a1', novaRole: 'admin', usuarioAtualId: 'a1', users }).ok).toBe(true);
  });

  it('blocks demoting the last admin', () => {
    const so1 = users.filter((u) => u.id !== 'a2');
    const r = validarMudancaRole({ alvoId: 'a1', novaRole: 'operador', usuarioAtualId: 'zz', users: so1 });
    expect(r.ok).toBe(false);
  });

  it('allows demoting an admin when another remains', () => {
    expect(validarMudancaRole({ alvoId: 'a2', novaRole: 'operador', usuarioAtualId: 'a1', users }).ok).toBe(true);
  });

  it('allows promoting and unrelated changes', () => {
    expect(validarMudancaRole({ alvoId: 'o1', novaRole: 'admin', usuarioAtualId: 'a1', users }).ok).toBe(true);
  });

  it('returns a reason when blocked', () => {
    const r = validarMudancaRole({ alvoId: 'a1', novaRole: 'operador', usuarioAtualId: 'a1', users });
    expect(typeof r.motivo).toBe('string');
  });
});

describe('validarExclusao', () => {
  it('blocks deleting yourself', () => {
    expect(validarExclusao({ alvoId: 'a1', usuarioAtualId: 'a1', users }).ok).toBe(false);
  });

  it('blocks deleting the last admin', () => {
    const so1 = users.filter((u) => u.id !== 'a2');
    expect(validarExclusao({ alvoId: 'a1', usuarioAtualId: 'zz', users: so1 }).ok).toBe(false);
  });

  it('allows deleting another admin or an operator', () => {
    expect(validarExclusao({ alvoId: 'a2', usuarioAtualId: 'a1', users }).ok).toBe(true);
    expect(validarExclusao({ alvoId: 'o1', usuarioAtualId: 'a1', users }).ok).toBe(true);
  });
});

describe('criarGuardaEnvio', () => {
  it('ignores a second call while the first is pending', async () => {
    const guarda = criarGuardaEnvio();
    let chamadas = 0;
    let liberar;
    const tarefa = () => { chamadas += 1; return new Promise((res) => { liberar = res; }); };
    const p1 = guarda(tarefa);
    const p2 = guarda(tarefa);
    expect(await p2).toBeUndefined();
    expect(chamadas).toBe(1);
    liberar('ok');
    expect(await p1).toBe('ok');
  });

  it('allows a new call after completion, including after a throw', async () => {
    const guarda = criarGuardaEnvio();
    await expect(guarda(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(await guarda(async () => 7)).toBe(7);
  });

  it('exposes whether it is busy', async () => {
    const guarda = criarGuardaEnvio();
    expect(guarda.ocupado()).toBe(false);
    let liberar;
    const p = guarda(() => new Promise((res) => { liberar = res; }));
    expect(guarda.ocupado()).toBe(true);
    liberar();
    await p;
    expect(guarda.ocupado()).toBe(false);
  });
});

describe('descricaoOperador (texto do diálogo de exclusão)', () => {
  it('admin: nome e login da conta, para não excluir a errada', () => {
    expect(descricaoOperador({ name: 'Beto', username: 'beto' }, true)).toBe('Beto (login: beto)');
  });
  it('sem acesso ao login: só o nome', () => {
    expect(descricaoOperador({ name: 'Beto' }, false)).toBe('Beto');
    expect(descricaoOperador({ name: 'Beto', username: 'beto' }, false)).toBe('Beto');
  });
  it('conta não encontrada: não inventa nome', () => {
    expect(descricaoOperador(undefined, true)).toBe('conta selecionada');
  });
});
