const BASE = import.meta.env.VITE_API_URL || "http://localhost:8080";

function authHeaders() {
  const token = localStorage.getItem("fss_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = "GET", body, raw } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка запроса (${res.status})`);
  return data;
}

// fetch() has no upload-progress events — XHR does. Used for every file upload
// (Portfolio materials, FSS/Target imports) so the UI can show a real progress bar.
function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    const token = localStorage.getItem("fss_token");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Ошибка загрузки (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Сетевая ошибка при загрузке"));
    xhr.send(formData);
  });
}

export const api = {
  login: (email, password) => request("/api/auth/login", { method: "POST", body: { email, password } }),
  requestReset: (email) => request("/api/auth/request-reset", { method: "POST", body: { email } }),
  updateMe: (payload) => request("/api/auth/me", { method: "PUT", body: payload }),
  me: () => request("/api/auth/me"),

  listUsers: () => request("/api/users"),
  listRms: () => request("/api/users/rms"),
  listTerritories: () => request("/api/territories"),
  listGroups: () => request("/api/groups"),
  createGroup: (name) => request("/api/groups", { method: "POST", body: { name } }),
  createUser: (payload) => request("/api/users", { method: "POST", body: payload }),
  patchUser: (id, payload) => request(`/api/users/${id}`, { method: "PATCH", body: payload }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: "DELETE" }),
  mpProfile: (mpId) => request(`/api/mp-profile/${mpId}`),
  saveDevelopmentPlan: (mpId, payload) => request(`/api/development-plans/${mpId}`, { method: "PUT", body: payload }),
  listTrackedDoctors: () => request("/api/doc-tracking/doctors"),
  createTrackedDoctor: (payload) => request("/api/doc-tracking/doctors", { method: "POST", body: payload }),
  updateTrackedDoctor: (id, payload) => request(`/api/doc-tracking/doctors/${id}`, { method: "PUT", body: payload }),
  getTrackedDoctor: (id) => request(`/api/doc-tracking/doctors/${id}`),
  addDoctorLog: (id, payload) => request(`/api/doc-tracking/doctors/${id}/log`, { method: "POST", body: payload }),
  deleteDoctorLog: (logId) => request(`/api/doc-tracking/log/${logId}`, { method: "DELETE" }),

  listPortfolio: () => request("/api/portfolio"),
  getPortfolioItem: (id) => request(`/api/portfolio/${id}`),
  createPortfolioItem: (payload) => request("/api/portfolio", { method: "POST", body: payload }),
  updatePortfolioItem: (id, payload) => request(`/api/portfolio/${id}`, { method: "PUT", body: payload }),
  deletePortfolioItem: (id) => request(`/api/portfolio/${id}`, { method: "DELETE" }),
  addCompetitor: (id, payload) => request(`/api/portfolio/${id}/competitors`, { method: "POST", body: payload }),
  updateCompetitor: (cid, payload) => request(`/api/portfolio/competitors/${cid}`, { method: "PUT", body: payload }),
  deleteCompetitor: (cid) => request(`/api/portfolio/competitors/${cid}`, { method: "DELETE" }),
  deletePortfolioFile: (fileId) => request(`/api/portfolio/files/${fileId}`, { method: "DELETE" }),
  portfolioOptions: () => request("/api/portfolio-options"),

  addVisualAid: (productId, formData, onProgress) => uploadWithProgress(`${BASE}/api/portfolio/${productId}/visual-aids`, formData, onProgress),
  updateVisualAid: (vaId, payload) => request(`/api/portfolio/visual-aids/${vaId}`, { method: "PUT", body: payload }),
  deleteVisualAid: (vaId) => request(`/api/portfolio/visual-aids/${vaId}`, { method: "DELETE" }),
  visualAidImageUrl: (vaId) => `${BASE}/api/portfolio/visual-aids/${vaId}/image?token=${localStorage.getItem("fss_token")}`,

  addPromoMaterial: (productId, formData, onProgress) => uploadWithProgress(`${BASE}/api/portfolio/${productId}/promo-materials`, formData, onProgress),
  updatePromoMaterial: (pmId, payload) => request(`/api/portfolio/promo-materials/${pmId}`, { method: "PUT", body: payload }),
  deletePromoMaterial: (pmId) => request(`/api/portfolio/promo-materials/${pmId}`, { method: "DELETE" }),
  promoMaterialFileUrl: (pmId) => `${BASE}/api/portfolio/promo-materials/${pmId}/file?token=${localStorage.getItem("fss_token")}`,

  addScientificInfo: (productId, formData, onProgress) => uploadWithProgress(`${BASE}/api/portfolio/${productId}/scientific-info`, formData, onProgress),
  deleteScientificInfo: (siId) => request(`/api/portfolio/scientific-info/${siId}`, { method: "DELETE" }),
  scientificInfoFileUrl: (siId) => `${BASE}/api/portfolio/scientific-info/${siId}/file?token=${localStorage.getItem("fss_token")}`,

  uploadUserPhoto: (userId, file, onProgress) => {
    const fd = new FormData();
    fd.append("photo", file);
    return uploadWithProgress(`${BASE}/api/users/${userId}/photo`, fd, onProgress);
  },
  userPhotoUrl: (userId) => `${BASE}/api/users/${userId}/photo?token=${localStorage.getItem("fss_token")}`,

  listActivityTypes: (category) => request(`/api/activity-types?category=${category}`),
  createActivityType: (payload) => request("/api/activity-types", { method: "POST", body: payload }),
  updateActivityType: (id, payload) => request(`/api/activity-types/${id}`, { method: "PUT", body: payload }),
  deleteActivityType: (id) => request(`/api/activity-types/${id}`, { method: "DELETE" }),
  listActivityEntries: (params) => request(`/api/activity-entries?${new URLSearchParams(params).toString()}`),
  createActivityEntry: (payload) => request("/api/activity-entries", { method: "POST", body: payload }),
  updateActivityEntry: (id, payload) => request(`/api/activity-entries/${id}`, { method: "PUT", body: payload }),
  deleteActivityEntry: (id) => request(`/api/activity-entries/${id}`, { method: "DELETE" }),
  activityReport: (params) => request(`/api/activity-report?${new URLSearchParams(params).toString()}`),

  listNaviDoctors: (search) => request(`/api/navi/doctors${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  createNaviDoctor: (payload) => request("/api/navi/doctors", { method: "POST", body: payload }),
  getNaviDoctor: (id) => request(`/api/navi/doctors/${id}`),
  updateNaviDoctor: (id, payload) => request(`/api/navi/doctors/${id}`, { method: "PUT", body: payload }),
  deleteNaviDoctor: (id) => request(`/api/navi/doctors/${id}`, { method: "DELETE" }),
  startNaviVisit: (id, lang) => request(`/api/navi/doctors/${id}/start-visit`, { method: "POST", body: { lang } }),
  reportNaviVisit: (visitId, mp_report) => request(`/api/navi/visits/${visitId}`, { method: "PUT", body: { mp_report } }),
  uploadPortfolioFile: (productId, fileType, file, onProgress) => {
    const fd = new FormData();
    fd.append("file", file); fd.append("file_type", fileType);
    return uploadWithProgress(`${BASE}/api/portfolio/${productId}/files`, fd, onProgress);
  },
  portfolioFileUrl: (fileId) => `${BASE}/api/portfolio/files/${fileId}`,
  portfolioBrochureUrl: (id) => `${BASE}/api/portfolio/${id}/brochure.pdf`,
  portfolioAllBrochureUrl: () => `${BASE}/api/portfolio-brochure.pdf`,

  listProducts: () => request("/api/products"),

  listReports: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/reports${qs ? "?" + qs : ""}`);
  },
  getOrCreateReport: (period_year, period_month) =>
    request("/api/reports", { method: "POST", body: { period_year, period_month } }),
  getReport: (id) => request(`/api/reports/${id}`),
  saveFss: (id, items) => request(`/api/reports/${id}/fss`, { method: "PUT", body: { items } }),
  saveFfe: (id, items, field_days) => request(`/api/reports/${id}/ffe`, { method: "PUT", body: { items, field_days } }),
  addOpportunity: (reportId, name) => request(`/api/reports/${reportId}/opportunities`, { method: "POST", body: { name } }),
  updateOpportunityValues: (reportId, oppId, values) => request(`/api/reports/${reportId}/opportunities/${oppId}`, { method: "PUT", body: { values } }),
  deleteOpportunity: (reportId, oppId) => request(`/api/reports/${reportId}/opportunities/${oppId}`, { method: "DELETE" }),
  saveActionPlan: (id, items) => request(`/api/reports/${id}/action-plan`, { method: "PUT", body: { items } }),
  saveConversion: (id, items) => request(`/api/reports/${id}/conversion`, { method: "PUT", body: { items } }),
  savePotential: (id, items) => request(`/api/reports/${id}/potential`, { method: "PUT", body: { items } }),
  saveSettings: (id, payload) => request(`/api/reports/${id}/settings`, { method: "PUT", body: payload }),
  submitReport: (id) => request(`/api/reports/${id}/submit`, { method: "POST" }),
  returnReport: (id, comment_text) => request(`/api/reports/${id}/return`, { method: "POST", body: { comment_text } }),
  approveReport: (id, comment_text) => request(`/api/reports/${id}/approve-rm`, { method: "POST", body: { comment_text } }),
  addComment: (id, payload) => request(`/api/reports/${id}/comment`, { method: "POST", body: payload }),

  mpBonus: (mpId, year, quarter) => request(`/api/mp-bonus/${mpId}?year=${year}&quarter=${quarter}`),
  rmBonus: (year, quarter, rmId) => request(`/api/rm-bonus?year=${year}&quarter=${quarter}${rmId ? `&rm_id=${rmId}` : ""}`),
  allComments: () => request("/api/comments/all"),
  aiInsightsStatus: () => request("/api/ai-insights/status"),
  aiInsights: (refresh) => request(`/api/ai-insights${refresh ? "?refresh=true" : ""}`),
  dashboard: () => request("/api/dashboard"),
  importHistory: () => request("/api/import/history"),
  undoImport: (id) => request(`/api/import/${id}/undo`, { method: "POST" }),
  passwordResets: () => request("/api/password-resets"),
  resolveReset: (userId, password) => request(`/api/users/${userId}`, { method: "PATCH", body: { password } }),

  exportUrl: (id, type) => `${BASE}/api/reports/${id}/export/${type}`,

  importFss: (file, year, month, onProgress) => {
    const fd = new FormData();
    fd.append("file", file); fd.append("year", year); fd.append("month", month);
    return uploadWithProgress(`${BASE}/api/import/fss`, fd, onProgress);
  },
  importTargets: (file, fy, onProgress) => {
    const fd = new FormData();
    fd.append("file", file); fd.append("fy", fy);
    return uploadWithProgress(`${BASE}/api/import/targets`, fd, onProgress);
  },
};

export function authedDownload(url) {
  // exports require the Authorization header, so fetch as blob then trigger a save
  return fetch(url, { headers: authHeaders() }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Не удалось скачать файл");
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const match = cd.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : "report";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

export const MONTH_NAMES_RU = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
export function monthName(m) { return MONTH_NAMES_RU[(m - 1 + 12) % 12]; }
