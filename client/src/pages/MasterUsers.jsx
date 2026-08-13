import React, { useEffect, useState } from "react";
import { api } from "../api.js";

const ROLE_LABEL = { master: "Мастер", rm: "РМ", mp: "МП", bm: "БМ" };

function GroupManager({ groups, onCreated }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true); setError("");
    try { await api.createGroup(name.trim()); setName(""); onCreated(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#141F33", border: "1px solid #22304A" }}>
      <div className="font-display text-lg mb-3">Группы (портфолио)</div>
      <div className="flex flex-wrap gap-2 mb-3">
        {groups.map((g) => (
          <span key={g.id} className="px-3 py-1.5 rounded-full text-sm" style={{ background: "#22304A" }}>{g.name}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название новой группы"
          className="bg-transparent border rounded px-3 py-2 text-sm flex-1" style={{ borderColor: "#3A4A66" }} />
        <button onClick={add} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#3FB88F", color: "#0E1726" }}>+ Добавить</button>
      </div>
      {error && <div className="text-sm mt-2" style={{ color: "#E2574C" }}>{error}</div>}
    </div>
  );
}

function CreateUserForm({ rms, territories, groups, onCreated }) {
  const [role, setRole] = useState("mp");
  const [form, setForm] = useState({ email: "", password: "", full_name: "", territory: "", rm_id: "", group_id: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await api.createUser({
        ...form, role,
        rm_id: role === "mp" ? form.rm_id : undefined,
        territory: role === "mp" ? form.territory : undefined,
        group_id: (role === "mp" || role === "bm") ? form.group_id : undefined,
      });
      setForm({ email: "", password: "", full_name: "", territory: "", rm_id: "", group_id: "" });
      onCreated();
    } catch (e2) { setError(e2.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl p-4 sm:p-5 mb-8" style={{ background: "#141F33", border: "1px solid #22304A" }}>
      <div className="font-display text-lg mb-4">Создать аккаунт</div>
      <div className="flex flex-wrap gap-2 mb-4">
        {[["mp", "Медпред (МП)"], ["rm", "Региональный менеджер (РМ)"], ["bm", "Бренд-менеджер (БМ)"]].map(([v, label]) => (
          <button type="button" key={v} onClick={() => setRole(v)}
            className="px-3 py-1.5 rounded text-sm"
            style={{ background: role === v ? "#E8B04B" : "#22304A", color: role === v ? "#0E1726" : "#C9D2E0" }}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <input required placeholder="Имя Фамилия" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#3A4A66" }} />
        <input required type="email" placeholder="email@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#3A4A66" }} />
        <input required type="password" placeholder="Пароль" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#3A4A66" }} />
        {role === "mp" && (
          <select required value={form.territory} onChange={(e) => setForm({ ...form, territory: e.target.value })}
            className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#3A4A66" }}>
            <option value="" style={{ color: "#000" }}>— выберите территорию —</option>
            {territories.map((t) => <option key={t.key} value={t.label} style={{ color: "#000" }}>{t.label}</option>)}
          </select>
        )}
        {(role === "mp" || role === "bm") && (
          <select required value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}
            className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#3A4A66" }}>
            <option value="" style={{ color: "#000" }}>— выберите группу —</option>
            {groups.map((g) => <option key={g.id} value={g.id} style={{ color: "#000" }}>{g.name}</option>)}
          </select>
        )}
        {role === "mp" && (
          <select required value={form.rm_id} onChange={(e) => setForm({ ...form, rm_id: e.target.value })}
            className="bg-transparent border rounded px-3 py-2 sm:col-span-2" style={{ borderColor: "#3A4A66" }}>
            <option value="" style={{ color: "#000" }}>— выберите РМ, к которому прикрепить МП —</option>
            {rms.map((rm) => <option key={rm.id} value={rm.id} style={{ color: "#000" }}>{rm.full_name} ({rm.territory || "—"})</option>)}
          </select>
        )}
      </div>
      {error && <div className="text-sm mt-3" style={{ color: "#E2574C" }}>{error}</div>}
      <button disabled={busy} type="submit" className="mt-4 px-5 py-2.5 rounded font-semibold" style={{ background: "#3FB88F", color: "#0E1726" }}>
        {busy ? "Создание…" : "Создать аккаунт"}
      </button>
    </form>
  );
}

function ResetRequests({ onResolved }) {
  const [requests, setRequests] = useState([]);
  const [passwords, setPasswords] = useState({});
  const [busyId, setBusyId] = useState(null);

  async function load() { setRequests(await api.passwordResets()); }
  useEffect(() => { load(); }, []);

  async function resolve(userId, reqId) {
    const pw = passwords[reqId];
    if (!pw || pw.length < 6) { alert("Введите новый пароль (минимум 6 символов)"); return; }
    setBusyId(reqId);
    try { await api.resolveReset(userId, pw); await load(); onResolved?.(); }
    finally { setBusyId(null); }
  }

  if (requests.length === 0) return null;
  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#E8B04B15", border: "1px solid #E8B04B44" }}>
      <div className="font-display text-lg mb-3" style={{ color: "#E8B04B" }}>Запросы на восстановление пароля ({requests.length})</div>
      <div className="space-y-2">
        {requests.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg p-3" style={{ background: "#141F33" }}>
            <div className="text-sm flex-1 min-w-[160px]">
              <b>{r.full_name}</b> <span style={{ color: "#8493AA" }}>({r.email}) · {ROLE_LABEL[r.role]}</span>
            </div>
            <input type="password" placeholder="Новый пароль" value={passwords[r.id] || ""} onChange={(e) => setPasswords((p) => ({ ...p, [r.id]: e.target.value }))}
              className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#3A4A66", width: "160px" }} />
            <button onClick={() => resolve(r.user_id, r.id)} disabled={busyId === r.id} className="px-3 py-1.5 rounded text-sm font-semibold" style={{ background: "#3FB88F", color: "#0E1726" }}>
              Задать пароль
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditUserRow({ u, rms, territories, groups, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ full_name: u.full_name, territory: u.territory || "", rm_id: u.rm_id || "", group_id: u.group_id || "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setError("");
    try {
      const payload = { full_name: form.full_name };
      if (u.role === "mp") { payload.territory = form.territory; payload.rm_id = form.rm_id; }
      if (u.role === "mp" || u.role === "bm") payload.group_id = form.group_id || null;
      await api.patchUser(u.id, payload);
      setEditing(false);
      onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function toggleActive() {
    if (u.is_active) {
      if (!confirm(`Удалить аккаунт «${u.full_name}»? Он потеряет доступ к системе.`)) return;
      if (!confirm(`Это нужно подтвердить ещё раз. Точно удалить «${u.full_name}»?`)) return;
      setBusy(true);
      try { await api.deleteUser(u.id); onSaved(); } catch (e) { setError(e.message); } finally { setBusy(false); }
    } else {
      setBusy(true);
      try { await api.patchUser(u.id, { is_active: true }); onSaved(); } catch (e) { setError(e.message); } finally { setBusy(false); }
    }
  }

  if (editing) {
    return (
      <tr style={{ borderTop: "1px solid #22304A", background: "#1B2A44" }}>
        <td colSpan={7} className="px-4 py-3">
          <div className="grid sm:grid-cols-2 gap-2 text-sm mb-2">
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Имя"
              className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#3A4A66" }} />
            {u.role === "mp" && (
              <select value={form.territory} onChange={(e) => setForm({ ...form, territory: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#3A4A66" }}>
                {territories.map((t) => <option key={t.key} value={t.label} style={{ color: "#000" }}>{t.label}</option>)}
              </select>
            )}
            {(u.role === "mp" || u.role === "bm") && (
              <select value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#3A4A66" }}>
                <option value="" style={{ color: "#000" }}>Без группы</option>
                {groups.map((g) => <option key={g.id} value={g.id} style={{ color: "#000" }}>{g.name}</option>)}
              </select>
            )}
            {u.role === "mp" && (
              <select value={form.rm_id} onChange={(e) => setForm({ ...form, rm_id: e.target.value })} className="bg-transparent border rounded px-2 py-1.5 sm:col-span-2" style={{ borderColor: "#3A4A66" }}>
                {rms.map((rm) => <option key={rm.id} value={rm.id} style={{ color: "#000" }}>{rm.full_name}</option>)}
              </select>
            )}
          </div>
          {error && <div className="text-xs mb-2" style={{ color: "#E2574C" }}>{error}</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded text-xs font-semibold" style={{ background: "#3FB88F", color: "#0E1726" }}>Сохранить</button>
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded text-xs" style={{ background: "#22304A" }}>Отмена</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ borderTop: "1px solid #22304A", opacity: u.is_active ? 1 : 0.5 }}>
      <td className="px-4 py-3">{u.full_name} {!u.is_active && <span style={{ color: "#E2574C" }}>(удалён)</span>}</td>
      <td className="px-4 py-3">{ROLE_LABEL[u.role] || u.role}</td>
      <td className="px-4 py-3" style={{ color: "#8493AA" }}>{u.rm_name || "—"}</td>
      <td className="px-4 py-3" style={{ color: "#8493AA" }}>{u.group_name || "—"}</td>
      <td className="px-4 py-3" style={{ color: "#8493AA" }}>{u.territory || "—"}</td>
      <td className="px-4 py-3" style={{ color: "#8493AA" }}>{u.email}</td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {u.role !== "master" && (
          <>
            <button onClick={() => setEditing(true)} className="text-xs mr-3" style={{ color: "#E8B04B" }}>Изменить</button>
            <button onClick={toggleActive} disabled={busy} className="text-xs" style={{ color: u.is_active ? "#E2574C" : "#3FB88F" }}>
              {u.is_active ? "Удалить" : "Восстановить"}
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

export default function MasterUsers() {
  const [users, setUsers] = useState([]);
  const [rms, setRms] = useState([]);
  const [territories, setTerritories] = useState([]);
  const [groups, setGroups] = useState([]);

  async function loadAll() {
    setUsers(await api.listUsers());
    setRms(await api.listRms());
    setTerritories(await api.listTerritories());
    setGroups(await api.listGroups());
  }
  useEffect(() => { loadAll(); }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
      <div className="font-display text-2xl font-semibold mb-1">Пользователи</div>
      <div className="text-sm mb-6" style={{ color: "#8493AA" }}>Создание аккаунтов РМ, БМ и медпредов</div>

      <ResetRequests onResolved={loadAll} />
      <GroupManager groups={groups} onCreated={loadAll} />
      <CreateUserForm rms={rms} territories={territories} groups={groups} onCreated={loadAll} />

      <div className="rounded-2xl overflow-x-auto" style={{ border: "1px solid #22304A" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#141F33", color: "#8493AA" }} className="uppercase text-xs">
              <th className="text-left px-4 py-3">Имя</th><th className="text-left px-4 py-3">Роль</th>
              <th className="text-left px-4 py-3">РМ</th><th className="text-left px-4 py-3">Группа</th>
              <th className="text-left px-4 py-3">Территория</th><th className="text-left px-4 py-3">Email</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <EditUserRow key={u.id} u={u} rms={rms} territories={territories} groups={groups} onSaved={loadAll} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
