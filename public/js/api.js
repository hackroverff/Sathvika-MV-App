const API = {
  base: '/api',

  token(kind) {
    // kind: 'customer' | 'owner' -- kept as separate localStorage keys so a
    // shop assistant can be signed in on the owner console in one tab and a
    // customer can browse in another without the two sessions colliding.
    return localStorage.getItem(`smv_token_${kind}`);
  },
  setToken(kind, token) {
    if (token) localStorage.setItem(`smv_token_${kind}`, token);
  },
  clearToken(kind) {
    localStorage.removeItem(`smv_token_${kind}`);
  },

  async req(method, path, body, kind) {
    const headers = { 'Content-Type': 'application/json' };
    const token = kind ? this.token(kind) : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }

    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      /* empty body */
    }

    if (!res.ok) {
      const err = new Error(data.error || 'Something went wrong.');
      err.status = res.status;
      throw err;
    }
    return data;
  },

  get(path, kind) { return this.req('GET', path, undefined, kind); },
  post(path, body, kind) { return this.req('POST', path, body, kind); },
  put(path, body, kind) { return this.req('PUT', path, body, kind); },
  del(path, kind) { return this.req('DELETE', path, undefined, kind); },
};
