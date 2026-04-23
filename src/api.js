// Matthews CRM — Cloud SQL API Layer
const API_BASE = 'https://us-central1-tmc-crm-f3728.cloudfunctions.net';

let _authToken = null;
let _authTokenExpiry = 0;

async function getToken() {
    if (_authToken && _authTokenExpiry > Date.now()) return _authToken;
    const user = window.firebaseAuth?.currentUser;
    if (!user) return null;
    _authToken = await user.getIdToken();
    _authTokenExpiry = Date.now() + 3500000;
    return _authToken;
}

function headers(token) {
    return {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'};
}

// Convert camelCase to snake_case
function toSnake(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
        const sk = k.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
        if (v !== undefined) result[sk] = v;
    }
    return result;
}

// Convert snake_case to camelCase
function toCamel(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
        const ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        result[ck] = v;
    }
    return result;
}

const api = {
    async get(table) {
        const token = await getToken();
        if (!token) return [];
        try {
            const res = await fetch(`${API_BASE}/api/${table}`, {headers: headers(token)});
            if (!res.ok) return [];
            return await res.json();
        } catch { return []; }
    },

    async getOne(table, id) {
        const token = await getToken();
        if (!token) return null;
        try {
            const res = await fetch(`${API_BASE}/api/${table}/${id}`, {headers: headers(token)});
            if (!res.ok) return null;
            return await res.json();
        } catch { return null; }
    },

    async create(table, data) {
        const token = await getToken();
        if (!token) return data;
        try {
            const clean = {...data};
            Object.keys(clean).forEach(k => { if (clean[k] === undefined || clean[k] === null) delete clean[k]; });
            const res = await fetch(`${API_BASE}/api/${table}`, {
                method: 'POST', headers: headers(token), body: JSON.stringify(clean)
            });
            if (res.ok) return await res.json();
        } catch (e) { console.log('API create error:', e.message); }
        return data;
    },

    async update(table, id, data) {
        const token = await getToken();
        if (!token) return data;
        try {
            const clean = {...data};
            Object.keys(clean).forEach(k => { if (clean[k] === undefined || clean[k] === null) delete clean[k]; });
            const res = await fetch(`${API_BASE}/api/${table}/${id}`, {
                method: 'PUT', headers: headers(token), body: JSON.stringify(clean)
            });
            if (res.ok) return await res.json();
        } catch (e) { console.log('API update error:', e.message); }
        return data;
    },

    async upsert(table, record) {
        if (!record.id) return record;
        const token = await getToken();
        if (!token) return record;
        const clean = {...record};
        Object.keys(clean).forEach(k => { if (clean[k] === undefined || clean[k] === null) delete clean[k]; });
        try {
            let res = await fetch(`${API_BASE}/api/${table}/${record.id}`, {
                method: 'PUT', headers: headers(token), body: JSON.stringify(clean)
            });
            if (res.status === 404) {
                res = await fetch(`${API_BASE}/api/${table}`, {
                    method: 'POST', headers: headers(token), body: JSON.stringify(clean)
                });
            }
            if (res.ok) return await res.json();
        } catch (e) { console.log('API upsert error:', e.message); }
        return record;
    },

    async remove(table, id) {
        const token = await getToken();
        if (!token) return;
        try {
            await fetch(`${API_BASE}/api/${table}/${id}`, {
                method: 'DELETE', headers: headers(token)
            });
        } catch (e) { console.log('API delete error:', e.message); }
    },

    async loadAll() {
        const token = await getToken();
        if (!token) return null;
        try {
            const res = await fetch(`${API_BASE}/bulk`, {headers: headers(token)});
            if (!res.ok) return null;
            return await res.json();
        } catch { return null; }
    },

    async migrateAll(data) {
        const token = await getToken();
        if (!token) return;
        try {
            await fetch(`${API_BASE}/bulk`, {
                method: 'POST', headers: headers(token), body: JSON.stringify(data)
            });
        } catch (e) { console.log('Migration error:', e.message); }
    }
};

export default api;
export { api, getToken };
