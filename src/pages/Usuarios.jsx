import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { UserPlus, Mail } from "lucide-react";

const ROLES = [
  { value: "admin", label: "Admin (Directora)", desc: "Acceso completo a todo el sistema" },
  { value: "cap_terapias", label: "Capturista Terapias", desc: "Solo puede capturar sesiones mensuales" },
  { value: "cap_pagos", label: "Capturista Pagos", desc: "Solo puede registrar pagos y ver cobranza" },
  { value: "cap_gastos", label: "Capturista Gastos", desc: "Solo puede registrar gastos" },
];

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState("cap_terapias");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    base44.entities.User.list().then(u => { setUsuarios(u); setLoading(false); });
  }, []);

  const invite = async () => {
    if (!email) return;
    setInviting(true);
    try {
      // inviteUser solo acepta "user" o "admin"
      const baseRole = rol === "admin" ? "admin" : "user";
      await base44.users.inviteUser(email, baseRole);

      // Si el rol deseado es custom, buscar al usuario recién creado y asignarle el rol
      if (rol !== "admin" && rol !== "user") {
        await new Promise(r => setTimeout(r, 2000));
        const users = await base44.entities.User.list();
        const newUser = users.find(u => u.email === email);
        if (newUser) await base44.entities.User.update(newUser.id, { role: rol });
      }

      const users = await base44.entities.User.list();
      setUsuarios(users);
      setMsg(`Invitación enviada a ${email}`);
      setEmail("");
      setShowInvite(false);
      setTimeout(() => setMsg(""), 5000);
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (userId, newRole) => {
    await base44.entities.User.update(userId, { role: newRole });
    base44.entities.User.list().then(setUsuarios);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Administración de Usuarios</h1>
        <button onClick={() => setShowInvite(true)} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl">
          <UserPlus size={16} /> Invitar Usuario
        </button>
      </div>

      {msg && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">{msg}</div>
      )}

      {/* Roles description */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {ROLES.map(r => (
          <div key={r.value} className="bg-white rounded-xl border border-stone-100 p-3 shadow-sm">
            <p className="text-xs font-bold text-violet-700 mb-1">{r.label}</p>
            <p className="text-xs text-stone-400">{r.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Usuario</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Rol</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Cambiar Rol</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-stone-400">Cargando...</td></tr>
              ) : usuarios.map(u => (
                <tr key={u.id} className="border-t border-stone-50 hover:bg-stone-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center">
                        <span className="text-xs font-bold text-violet-700">{u.full_name?.[0] || u.email?.[0]}</span>
                      </div>
                      <span className="font-medium text-stone-800">{u.full_name || "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-stone-500">
                    <span className="flex items-center gap-1"><Mail size={12} />{u.email}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">{u.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    <select value={u.role || "user"} onChange={e => changeRole(u.id, e.target.value)}
                      className="border border-stone-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-200">
                      {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showInvite && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="font-semibold text-stone-800 mb-4">Invitar Nuevo Usuario</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Rol</label>
                <select value={rol} onChange={e => setRol(e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowInvite(false)} className="px-4 py-2 text-sm text-stone-600 border border-stone-200 rounded-xl hover:bg-stone-50">Cancelar</button>
              <button onClick={invite} disabled={inviting}
                className="px-4 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-60">
                {inviting ? "Enviando..." : "Enviar Invitación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}