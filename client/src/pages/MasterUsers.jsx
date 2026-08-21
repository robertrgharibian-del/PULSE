import React, { useEffect, useState } from "react";
import Avatar from "../components/Avatar.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

const ROLE_LABEL_KEY = { master: "role.master_short", rm: "role.rm_short", mp: "role.mp_short", bm: "role.bm_short" };

function GroupManager({ groups, onCreated }) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true); setError("");
    try { await api.createGroup(name.trim()); setName(""); onCreated(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(g) {
    if (!confirm(t("users.confirm_delete_group", { name: g.name }))) return;
    try { await api.deleteGroup(g.id); onCreated(); } catch (e) { setError(e.message); }
  }

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-3">{t("users.groups_title")}</div>
      <div className="flex flex-wrap gap-2 mb-3">
        {groups.map((g) => (
          <span key={g.id} className="px-3 py-1.5 rounded-full text-sm flex items-center gap-2" style={{ background: "#E4E7F0" }}>
            {g.name}
            <button onClick={() => remove(g)} className="text-xs" style={{ color: "#DC2626" }} title={t("common.delete")}>✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("users.new_group_name")}
          className="bg-transparent border rounded px-3 py-2 text-sm flex-1" style={{ borderColor: "#D3D8E4" }} />
        <button onClick={add} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>+ {t("common.add")}</button>
      </div>
      {error && <div className="text-sm mt-2" style={{ color: "#DC2626" }}>{error}</div>}
    </div>
  );
}

function TerritoryPicker({ value, onChange, territories, onTerritoryAdded, t }) {
  const [addingNew, setAddingNew] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function addNew() {
    if (!newLabel.trim()) return;
    setBusy(true); setError("");
    try {
      const created = await api.createTerritory(newLabel.trim());
      await onTerritoryAdded();
      onChange(created.label);
      setNewLabel(""); setAddingNew(false);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (addingNew) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={t("users.new_territory_placeholder")}
            className="bg-transparent border rounded px-2 py-1.5 text-sm flex-1" style={{ borderColor: "#D3D8E4" }} />
          <button type="button" onClick={addNew} disabled={busy} className="px-3 py-1.5 rounded text-xs font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{t("common.add")}</button>
          <button type="button" onClick={() => setAddingNew(false)} className="px-2 py-1.5 rounded text-xs" style={{ background: "#E4E7F0" }}>✕</button>
        </div>
        {error && <div className="text-xs" style={{ color: "#DC2626" }}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm flex-1" style={{ borderColor: "#D3D8E4" }}>
        <option value="" style={{ color: "#000" }}>{t("users.select_territory")}</option>
        {territories.map((t2) => <option key={t2.key} value={t2.label} style={{ color: "#000" }}>{t2.label}</option>)}
      </select>
      <button type="button" onClick={() => setAddingNew(true)} className="px-2 py-1.5 rounded text-xs whitespace-nowrap" style={{ background: "#E4E7F0" }}>+ {t("users.new_territory")}</button>
    </div>
  );
}

function CreateUserForm({ rms, territories, groups, onCreated, onTerritoryAdded }) {
  const { t } = useLanguage();
  const [role, setRole] = useState("mp");
  const [form, setForm] = useState({ email: "", password: "", full_name: "", territory: "", rm_id: "", group_id: "" });
  const [rmTerritories, setRmTerritories] = useState([]);
  const [pickedTerritory, setPickedTerritory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function addRmTerritoryStaged() {
    if (!pickedTerritory || rmTerritories.includes(pickedTerritory)) return;
    setRmTerritories((r) => [...r, pickedTerritory]);
    setPickedTerritory("");
  }

  async function submit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const created = await api.createUser({
        ...form, role,
        rm_id: role === "mp" ? form.rm_id : undefined,
        territory: role === "mp" ? form.territory : undefined,
        group_id: (role === "mp" || role === "bm") ? form.group_id : undefined,
      });
      if (role === "rm" && rmTerritories.length && created?.id) {
        for (const territory of rmTerritories) {
          await api.addRmTerritory(created.id, territory);
        }
      }
      setForm({ email: "", password: "", full_name: "", territory: "", rm_id: "", group_id: "" });
      setRmTerritories([]);
      onCreated();
    } catch (e2) { setError(e2.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl p-4 sm:p-5 mb-8" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-4">{t("users.create_account")}</div>
      <div className="flex flex-wrap gap-2 mb-4">
        {[["mp", t("users.role_mp")], ["rm", t("users.role_rm")], ["bm", t("users.role_bm")]].map(([v, label]) => (
          <button type="button" key={v} onClick={() => setRole(v)}
            className="px-3 py-1.5 rounded text-sm"
            style={{ background: role === v ? "#ED3237" : "#E4E7F0", color: role === v ? "#FFFFFF" : "#374151" }}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <input required placeholder={t("users.full_name_placeholder")} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        <input required type="email" placeholder="email@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        <input required type="password" placeholder={t("common.password")} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        {role === "mp" && (
          <TerritoryPicker value={form.territory} onChange={(v) => setForm({ ...form, territory: v })} territories={territories} onTerritoryAdded={onTerritoryAdded} t={t} />
        )}
        {(role === "mp" || role === "bm") && (
          <select required value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}
            className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }}>
            <option value="" style={{ color: "#000" }}>{t("users.select_group")}</option>
            {groups.map((g) => <option key={g.id} value={g.id} style={{ color: "#000" }}>{g.name}</option>)}
          </select>
        )}
        {role === "mp" && (
          <select required value={form.rm_id} onChange={(e) => setForm({ ...form, rm_id: e.target.value })}
            className="bg-transparent border rounded px-3 py-2 sm:col-span-2" style={{ borderColor: "#D3D8E4" }}>
            <option value="" style={{ color: "#000" }}>{t("users.select_rm")}</option>
            {rms.map((rm) => <option key={rm.id} value={rm.id} style={{ color: "#000" }}>{rm.full_name} ({rm.territory || "—"})</option>)}
          </select>
        )}
        {role === "rm" && (
          <div className="sm:col-span-2">
            <div className="text-xs mb-1" style={{ color: "#6B7280" }}>{t("users.rm_territories")}</div>
            <div className="flex flex-wrap gap-2 mb-2">
              {rmTerritories.map((terr) => (
                <span key={terr} className="px-2 py-1 rounded-full text-xs flex items-center gap-1" style={{ background: "#E4E7F0" }}>
                  {terr}
                  <button type="button" onClick={() => setRmTerritories((r) => r.filter((x) => x !== terr))} style={{ color: "#DC2626" }}>✕</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <TerritoryPicker value={pickedTerritory} onChange={setPickedTerritory} territories={territories.filter((t2) => !rmTerritories.includes(t2.label))} onTerritoryAdded={onTerritoryAdded} t={t} />
              <button type="button" onClick={addRmTerritoryStaged} disabled={!pickedTerritory} className="px-3 py-1.5 rounded text-xs font-semibold shrink-0" style={{ background: "#16A34A", color: "#FFFFFF" }}>+ {t("common.add")}</button>
            </div>
          </div>
        )}
      </div>
      {error && <div className="text-sm mt-3" style={{ color: "#DC2626" }}>{error}</div>}
      <button disabled={busy} type="submit" className="mt-4 px-5 py-2.5 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>
        {busy ? t("users.creating") : t("users.create_account")}
      </button>
    </form>
  );
}

function ResetRequests({ onResolved }) {
  const { t } = useLanguage();
  const [requests, setRequests] = useState([]);
  const [passwords, setPasswords] = useState({});
  const [busyId, setBusyId] = useState(null);

  async function load() { setRequests(await api.passwordResets()); }
  useEffect(() => { load(); }, []);

  async function resolve(userId, reqId) {
    const pw = passwords[reqId];
    if (!pw || pw.length < 6) { alert(t("users.enter_new_password_alert")); return; }
    setBusyId(reqId);
    try { await api.resolveReset(userId, pw); await load(); onResolved?.(); }
    finally { setBusyId(null); }
  }

  if (requests.length === 0) return null;
  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#ED323715", border: "1px solid #ED323744" }}>
      <div className="font-display text-lg mb-3" style={{ color: "#ED3237" }}>{t("users.reset_requests")} ({requests.length})</div>
      <div className="space-y-2">
        {requests.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg p-3" style={{ background: "#F7F8FC" }}>
            <div className="text-sm flex-1 min-w-[160px]">
              <b>{r.full_name}</b> <span style={{ color: "#6B7280" }}>({r.email}) · {t(ROLE_LABEL_KEY[r.role])}</span>
            </div>
            <input type="password" placeholder={t("users.new_password")} value={passwords[r.id] || ""} onChange={(e) => setPasswords((p) => ({ ...p, [r.id]: e.target.value }))}
              className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4", width: "160px" }} />
            <button onClick={() => resolve(r.user_id, r.id)} disabled={busyId === r.id} className="px-3 py-1.5 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>
              {t("users.set_password")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RmTerritoryManager({ rmId, territories, onTerritoryAdded, t }) {
  const [items, setItems] = useState([]);
  const [picked, setPicked] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() { setItems(await api.listRmTerritories(rmId)); }
  useEffect(() => { load(); }, [rmId]);

  async function add() {
    if (!picked) return;
    setBusy(true); setError("");
    try { await api.addRmTerritory(rmId, picked); setPicked(""); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(id) {
    setBusy(true); setError("");
    try { await api.removeRmTerritory(rmId, id); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const already = new Set(items.map((it) => it.territory));
  const selectable = territories.filter((t2) => !already.has(t2.label));

  return (
    <div className="sm:col-span-2">
      <span className="text-xs" style={{ color: "#6B7280" }}>{t("users.rm_territories")}</span>
      <div className="flex flex-wrap gap-2 mt-1 mb-2">
        {items.map((it) => (
          <span key={it.id} className="px-2 py-1 rounded-full text-xs flex items-center gap-1" style={{ background: "#E4E7F0" }}>
            {it.territory}
            <button onClick={() => remove(it.id)} disabled={busy} style={{ color: "#DC2626" }}>✕</button>
          </span>
        ))}
        {items.length === 0 && <span className="text-xs" style={{ color: "#9CA3AF" }}>{t("users.rm_territories_empty")}</span>}
      </div>
      <div className="flex gap-2">
        <TerritoryPicker value={picked} onChange={setPicked} territories={selectable} onTerritoryAdded={onTerritoryAdded} t={t} />
        <button onClick={add} disabled={busy || !picked} className="px-3 py-1.5 rounded text-xs font-semibold shrink-0" style={{ background: "#16A34A", color: "#FFFFFF" }}>+ {t("common.add")}</button>
      </div>
      {error && <div className="text-xs mt-1" style={{ color: "#DC2626" }}>{error}</div>}
    </div>
  );
}

function EditUserRow({ u, rms, territories, groups, onSaved, onTerritoryAdded }) {
  const { t } = useLanguage();
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
      if (!confirm(t("users.confirm_delete_1", { name: u.full_name }))) return;
      if (!confirm(t("users.confirm_delete_2", { name: u.full_name }))) return;
      setBusy(true);
      try { await api.deleteUser(u.id); onSaved(); } catch (e) { setError(e.message); } finally { setBusy(false); }
    } else {
      setBusy(true);
      try { await api.patchUser(u.id, { is_active: true }); onSaved(); } catch (e) { setError(e.message); } finally { setBusy(false); }
    }
  }

  async function permanentDelete() {
    if (!confirm(t("users.confirm_permanent_1", { name: u.full_name }))) return;
    const expectedWord = t("users.confirm_word");
    if (prompt(t("users.confirm_permanent_2", { word: expectedWord })) !== expectedWord) { alert(t("users.confirm_permanent_cancelled")); return; }
    setBusy(true);
    try { await api.deleteUserPermanent(u.id); onSaved(); } catch (e) { setError(e.message); } finally { setBusy(false); }
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
              <span className="text-xs" style={{ color: "#6B7280" }}>{t("common.name")}</span>
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "#6B7280" }}>Email</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "#6B7280" }}>{t("users.new_password_optional")}</span>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={t("users.leave_blank")}
                className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
            </label>
            {u.role === "mp" && (
              <label className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: "#6B7280" }}>{t("common.territory")}</span>
                <TerritoryPicker value={form.territory} onChange={(v) => setForm({ ...form, territory: v })} territories={territories} onTerritoryAdded={onTerritoryAdded} t={t} />
              </label>
            )}
            {(u.role === "mp" || u.role === "bm") && (
              <label className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: "#6B7280" }}>{t("common.group")}</span>
                <select value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
                  <option value="" style={{ color: "#000" }}>{t("users.no_group")}</option>
                  {groups.map((g) => <option key={g.id} value={g.id} style={{ color: "#000" }}>{g.name}</option>)}
                </select>
              </label>
            )}
            {u.role === "mp" && (
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs" style={{ color: "#6B7280" }}>{t("users.rm_label")}</span>
                <select value={form.rm_id} onChange={(e) => setForm({ ...form, rm_id: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
                  {rms.map((rm) => <option key={rm.id} value={rm.id} style={{ color: "#000" }}>{rm.full_name}</option>)}
                </select>
              </label>
            )}
            {u.role === "rm" && <RmTerritoryManager rmId={u.id} territories={territories} onTerritoryAdded={onTerritoryAdded} t={t} />}
          </div>
          {error && <div className="text-xs mb-2" style={{ color: "#DC2626" }}>{error}</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded text-xs font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{t("common.save")}</button>
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded text-xs" style={{ background: "#E4E7F0" }}>{t("common.cancel")}</button>
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
          {u.full_name} {!u.is_active && <span style={{ color: "#DC2626" }}>({t("users.deleted_suffix")})</span>}
        </div>
      </td>
      <td className="px-4 py-3">{t(ROLE_LABEL_KEY[u.role]) || u.role}</td>
      <td className="px-4 py-3" style={{ color: "#6B7280" }}>{u.rm_name || "—"}</td>
      <td className="px-4 py-3" style={{ color: "#6B7280" }}>{u.group_name || "—"}</td>
      <td className="px-4 py-3" style={{ color: "#6B7280" }}>{u.territory || "—"}</td>
      <td className="px-4 py-3" style={{ color: "#6B7280" }}>{u.email}</td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {error && <div className="text-xs mb-1" style={{ color: "#DC2626" }}>{error}</div>}
        <label className="text-xs mr-3 cursor-pointer" style={{ color: "#3E4095" }}>
          {photoBusy ? "…" : t("users.photo")}
          <input type="file" accept="image/*" onChange={uploadPhoto} className="hidden" disabled={photoBusy} />
        </label>
        {u.role !== "master" && (
          <>
            {u.is_active && <button onClick={() => setEditing(true)} className="text-xs mr-3" style={{ color: "#ED3237" }}>{t("common.change")}</button>}
            <button onClick={toggleActive} disabled={busy} className="text-xs mr-3" style={{ color: u.is_active ? "#DC2626" : "#16A34A" }}>
              {u.is_active ? t("common.delete") : t("common.restore")}
            </button>
            {!u.is_active && (
              <button onClick={permanentDelete} disabled={busy} className="text-xs font-semibold" style={{ color: "#DC2626" }}>
                {t("users.permanent_delete")}
              </button>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

export default function MasterUsers() {
  const { t } = useLanguage();
  const [users, setUsers] = useState([]);
  const [rms, setRms] = useState([]);
  const [territories, setTerritories] = useState([]);
  const [groups, setGroups] = useState([]);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [showArchive, setShowArchive] = useState(false);

  async function loadAll() {
    setUsers(await api.listUsers(showArchive));
    setRms(await api.listRms());
    setTerritories(await api.listTerritories());
    setGroups(await api.listGroups());
  }
  useEffect(() => { loadAll(); }, [showArchive]);

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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="font-display text-2xl font-semibold">{t("nav.users")}</div>
        <button onClick={() => setShowArchive((v) => !v)} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: showArchive ? "#ED3237" : "#E4E7F0", color: showArchive ? "#FFFFFF" : "#374151" }}>
          {showArchive ? t("users.back_to_active") : t("users.show_archive")}
        </button>
      </div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>{showArchive ? t("users.archive_subtitle") : t("users.subtitle")}</div>

      {!showArchive && (
        <>
          <ResetRequests onResolved={loadAll} />
          <GroupManager groups={groups} onCreated={loadAll} />
          <CreateUserForm rms={rms} territories={territories} groups={groups} onCreated={loadAll} onTerritoryAdded={loadAll} />
        </>
      )}

      <div className="rounded-2xl overflow-x-auto" style={{ border: "1px solid #E4E7F0" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#F7F8FC", color: "#6B7280" }} className="uppercase text-xs">
              <th className="text-left px-4 py-3">{t("common.name")}</th>
              <SortableHeader label={t("users.role")} sortField="role" />
              <SortableHeader label={t("users.rm_label")} sortField="rm_name" />
              <SortableHeader label={t("common.group")} sortField="group_name" />
              <SortableHeader label={t("common.territory")} sortField="territory" />
              <th className="text-left px-4 py-3">Email</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sortedUsers.map((u) => (
              <EditUserRow key={u.id} u={u} rms={rms} territories={territories} groups={groups} onSaved={loadAll} onTerritoryAdded={loadAll} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
