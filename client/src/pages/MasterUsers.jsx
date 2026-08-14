import React, { useEffect, useState } from "react";
import Avatar from "../components/Avatar.jsx";
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
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-3">Группы (портфолио)</div>
      <div className="flex flex-wrap gap-2 mb-3">
        {groups.map((g) => (
          <span key={g.id} className="px-3 py-1.5 rounded-full text-sm" style={{ background: "#E4E7F0" }}>{g.name}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название новой группы"
          className="bg-transparent border rounded px-3 py-2 text-sm flex-1" style={{ borderColor: "#D3D8E4" }} />
        <button onClick={add} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>+ Добавить</button>
      </div>
      {error && <div className="text-sm mt-2" style={{ color: "#DC2626" }}>{error}</div>}
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
    <form onSubmit={submit} className="rounded-2xl p-4 sm:p-5 mb-8" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-4">Создать аккаунт</div>
      <div className="flex flex-wrap gap-2 mb-4">
        {[["mp", "Медпред (МП)"], ["rm", "Региональный менеджер (РМ)"], ["bm", "Бренд-менеджер (БМ)"]].map(([v, label]) => (
          <button type="button" key={v} onClick={() => setRole(v)}
            className="px-3 py-1.5 rounded text-sm"
            style={{ background: role === v ? "#ED3237" : "#E4E7F0", color: role === v ? "#FFFFFF" : "#374151" }}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <input required placeholder="Имя Фамилия" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        <input required type="email" placeholder="email@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        <input required type="password" placeholder="Пароль" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        {role === "mp" && (
          <select required value={form.territory} onChange={(e) => setForm({ ...form, territory: e.target.value })}
            className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }}>
            <option value="" style={{ color: "#000" }}>— выберите территорию —</option>
            {territories.map((t) => <option key={t.key} value={t.label} style={{ color: "#000" }}>{t.label}</option>)}
          </select>
        )}
        {(role === "mp" || role === "bm") && (
          <select required value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}
            className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }}>
            <option value="" style={{ color: "#000" }}>— выберите группу —</option>
            {groups.map((g) => <option key={g.id} value={g.id} style={{ color: "#000" }}>{g.name}</option>)}
          </select>
        )}
        {role === "mp" && (
          <select required value={form.rm_id} onChange={(e) => setForm({ ...form, rm_id: e.target.value })}
            className="bg-transparent border rounded px-3 py-2 sm:col-span-2" style={{ borderColor: "#D3D8E4" }}>
            <option value="" style={{ color: "#000" }}>— выберите РМ, к которому прикрепить МП —</option>
            {rms.map((rm) => <option key={rm.id} value={rm.id} style={{ color: "#000" }}>{rm.full_name} ({rm.territory || "—"})</option>)}
          </select>
        )}
      </div>
      {error && <div className="text-sm mt-3" style={{ color: "#DC2626" }}>{error}</div>}
      <button disabled={busy} type="submit" className="mt-4 px-5 py-2.5 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>
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
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#ED323715", border: "1px solid #ED323744" }}>
      <div className="font-display text-lg mb-3" style={{ color: "#ED3237" }}>Запросы на восстановление пароля ({requests.length})</div>
      <div className="space-y-2">
        {requests.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg p-3" style={{ background: "#F7F8FC" }}>
            <div className="text-sm flex-1 min-w-[160px]">
              <b>{r.full_name}</b> <span style={{ color: "#6B7280" }}>({r.email}) · {ROLE_LABEL[r.role]}</span>
            </div>
            <input type="password" placeholder="Новый пароль" value={passwords[r.id] || ""} onChange={(e) => setPasswords((p) => ({ ...p, [r.id]: e.target.value }))}
              className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4", width: "160px" }} />
            <button onClick={() => resolve(r.user_id, r.id)} disabled={busyId === r.id} className="px-3 py-1.5 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>
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
  const [form, setForm] = useState({
    full_name: u.full_name, email: u.email, password: "",
    territory: u.territory || "", rm_id: u.rm_id || "", group_id: u.group_id || "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoKey, setPhotoKey] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);

  async function save() {
    setBusy(true); setError("");
    try {
      const payload = { full_name: form.full_name, email: form.email };
      if (form.password.trim()) payload.password = form.password.trim();
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

  async function uploadPhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoBusy(true); setError("");
    try { await api.uploadUserPhoto(u.id, file); setPhotoKey((k) => k + 1); }
    catch (err) { setError(err.message); } finally { setPhotoBusy(false); e.target.value = ""; }
  }

  if (editing) {
    return (
      <tr style={{ borderTop: "1px solid #E4E7F0", background: "#EEF1F8" }}>
        <td colSpan={7} className="px-4 py-3">
          <div className="grid sm:grid-cols-2 gap-2 text-sm mb-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "#6B7280" }}>Имя</span>
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "#6B7280" }}>Email</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "#6B7280" }}>Новый пароль (необязательно)</span>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Оставьте пустым, чтобы не менять"
                className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
            </label>
            {u.role === "mp" && (
              <label className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: "#6B7280" }}>Территория</span>
                <select value={form.territory} onChange={(e) => setForm({ ...form, territory: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
                  {territories.map((t) => <option key={t.key} value={t.label} style={{ color: "#000" }}>{t.label}</option>)}
                </select>
              </label>
            )}
            {(u.role === "mp" || u.role === "bm") && (
              <label className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: "#6B7280" }}>Группа</span>
                <select value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
                  <option value="" style={{ color: "#000" }}>Без группы</option>
                  {groups.map((g) => <option key={g.id} value={g.id} style={{ color: "#000" }}>{g.name}</option>)}
                </select>
              </label>
            )}
            {u.role === "mp" && (
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs" style={{ color: "#6B7280" }}>Региональный менеджер</span>
                <select value={form.rm_id} onChange={(e) => setForm({ ...form, rm_id: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
                  {rms.map((rm) => <option key={rm.id} value={rm.id} style={{ color: "#000" }}>{rm.full_name}</option>)}
                </select>
              </label>
            )}
          </div>
          {error && <div className="text-xs mb-2" style={{ color: "#DC2626" }}>{error}</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded text-xs font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>Сохранить</button>
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded text-xs" style={{ background: "#E4E7F0" }}>Отмена</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ borderTop: "1px solid #E4E7F0", opacity: u.is_active ? 1 : 0.5 }}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div key={photoKey}><Avatar userId={u.id} name={u.full_name} size={28} /></div>
          {u.full_name} {!u.is_active && <span style={{ color: "#DC2626" }}>(удалён)</span>}
        </div>
      </td>
      <td className="px-4 py-3">{ROLE_LABEL[u.role] || u.role}</td>
      <td className="px-4 py-3" style={{ color: "#6B7280" }}>{u.rm_name || "—"}</td>
      <td className="px-4 py-3" style={{ color: "#6B7280" }}>{u.group_name || "—"}</td>
      <td className="px-4 py-3" style={{ color: "#6B7280" }}>{u.territory || "—"}</td>
      <td className="px-4 py-3" style={{ color: "#6B7280" }}>{u.email}</td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {error && <div className="text-xs mb-1" style={{ color: "#DC2626" }}>{error}</div>}
        <label className="text-xs mr-3 cursor-pointer" style={{ color: "#3E4095" }}>
          {photoBusy ? "…" : "Фото"}
          <input type="file" accept="image/*" onChange={uploadPhoto} className="hidden" disabled={photoBusy} />
        </label>
        {u.role !== "master" && (
          <>
            <button onClick={() => setEditing(true)} className="text-xs mr-3" style={{ color: "#ED3237" }}>Изменить</button>
            <button onClick={toggleActive} disabled={busy} className="text-xs" style={{ color: u.is_active ? "#DC2626" : "#16A34A" }}>
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
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  async function loadAll() {
    setUsers(await api.listUsers());
    setRms(await api.listRms());
    setTerritories(await api.listTerritories());
    setGroups(await api.listGroups());
  }
  useEffect(() => { loadAll(); }, []);

  function toggleSort(key) {
    if (sortKey === key) { setSortDir((d) => (d === "asc" ? "desc" : "asc")); }
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sortedUsers = [...users].sort((a, b) => {
    if (!sortKey) return 0;
    const va = (a[sortKey] || "").toString().toLowerCase();
    const vb = (b[sortKey] || "").toString().toLowerCase();
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const SortableHeader = ({ label, sortField }) => (
    <th className="text-left px-4 py-3 cursor-pointer select-none" onClick={() => toggleSort(sortField)}>
      {label} {sortKey === sortField && (sortDir === "asc" ? "▲" : "▼")}
    </th>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
      <div className="font-display text-2xl font-semibold mb-1">Пользователи</div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>Создание аккаунтов РМ, БМ и медпредов</div>

      <ResetRequests onResolved={loadAll} />
      <GroupManager groups={groups} onCreated={loadAll} />
      <CreateUserForm rms={rms} territories={territories} groups={groups} onCreated={loadAll} />

      <div className="rounded-2xl overflow-x-auto" style={{ border: "1px solid #E4E7F0" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#F7F8FC", color: "#6B7280" }} className="uppercase text-xs">
              <th className="text-left px-4 py-3">Имя</th>
              <SortableHeader label="Роль" sortField="role" />
              <SortableHeader label="РМ" sortField="rm_name" />
              <SortableHeader label="Группа" sortField="group_name" />
              <SortableHeader label="Территория" sortField="territory" />
              <th className="text-left px-4 py-3">Email</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sortedUsers.map((u) => (
              <EditUserRow key={u.id} u={u} rms={rms} territories={territories} groups={groups} onSaved={loadAll} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
