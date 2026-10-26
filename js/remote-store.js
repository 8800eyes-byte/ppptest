/* Supabase 저장소 — PPP_CONFIG가 있으면 window.Store의 읽기·쓰기를 서버로 바꾼다.
 * 화면 코드가 그대로 쓸 수 있도록 로그인 후 볼 수 있는 데이터를 모두 메모리에 불러 두고(list/get은 동기),
 * 쓰기(upsert/remove)는 서버에 저장한 뒤 Promise로 결과를 돌려준다.
 * 어떤 행을 볼 수 있는지는 전부 DB의 RLS가 정한다(supabase/schema.sql).
 */
(function () {
  'use strict';

  var cfg = window.PPP_CONFIG;
  if (!cfg || !cfg.supabaseUrl || !cfg.supabaseKey) return;

  var L = window.Store;
  var sb = null;
  var cache = null;
  var me = null;
  var staff = [];

  var TABLES = {
    persons: ['code', 'name', 'gender', 'birthYM', 'disabilityType', 'stage', 'workerId', 'enrolledAt', 'oneLine',
      'dream', 'strengths', 'likes', 'dislikes', 'comfort', 'priorities', 'consent'],
    intakes: ['personId', 'date', 'route', 'applicant', 'needs', 'interestDomains', 'notes'],
    goals: ['personId', 'term', 'domain', 'text', 'plan', 'startDate', 'endDate', 'status', 'priority'],
    programs: ['personId', 'date', 'programName', 'domain', 'hours', 'attendance', 'satisfaction', 'note'],
    consultations: ['personId', 'date', 'type', 'participants', 'summary', 'nextAction'],
    evaluations: ['personId', 'date', 'period', 'selfScore', 'workerScore', 'achieved', 'adjust']
  };
  var NUMERIC = { priority: true, hours: true, satisfaction: true, selfScore: true, workerScore: true };
  var TO_SNAKE = { birthYM: 'birth_ym' };
  var TO_CAMEL = { birth_ym: 'birthYM' };

  function snake(k) { return TO_SNAKE[k] || k.replace(/[A-Z]/g, function (c) { return '_' + c.toLowerCase(); }); }
  function camel(k) { return TO_CAMEL[k] || k.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); }); }

  function toRow(col, rec) {
    var row = {};
    TABLES[col].forEach(function (k) {
      var v = rec[k];
      if (v === undefined) return;
      if (v === '') v = null;
      if (NUMERIC[k] && v !== null) v = Number(v);
      row[snake(k)] = v;
    });
    return row;
  }

  function fromRow(col, row) {
    var r = {};
    Object.keys(row).forEach(function (k) { r[camel(k)] = row[k]; });
    if (col === 'persons') r.worker = staffName(r.workerId);
    return r;
  }

  function staffName(id) {
    var s = staff.filter(function (x) { return x.id === id; })[0];
    return s ? s.name : '';
  }

  /* 서버 오류를 실무자가 이해할 수 있는 문장으로 */
  function friendly(err) {
    var code = err && err.code, msg = (err && err.message) || String(err);
    var text;
    if (code === '42501') text = '권한이 없습니다. 담당 이용자의 기록만 고칠 수 있어요.';
    else if (code === '23514') text = '입력값이 허용 범위를 벗어났습니다.';
    else if (code === '23505') text = '이미 있는 값과 겹칩니다.';
    else if (code === 'PGRST116') text = '기록을 찾을 수 없거나 권한이 없습니다.';
    else if (/rate limit/i.test(msg)) text = '메일 발송 한도를 넘었습니다. 1시간쯤 뒤에 다시 시도하거나 비밀번호로 로그인하세요.';
    else if (/fetch|network/i.test(msg)) text = '서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.';
    else text = msg;
    var e = new Error(text);
    e.code = code;
    return e;
  }

  function client() {
    if (!sb) {
      if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase 연결 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        // PKCE는 로그인 결과를 주소의 ?code= 로 돌려줘 화면 라우터(#/...)와 겹치지 않는다.
        // 링크 처리는 init()에서 직접 해서, 실패하면 이유를 화면에 보여 준다
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' }
      });
    }
    return sb;
  }

  /* 1000행 제한을 넘어도 모두 받는다 */
  function fetchAll(table) {
    var out = [], size = 1000;
    function page(from) {
      return client().from(table).select('*').is('deleted_at', null).order('created_at').range(from, from + size - 1)
        .then(function (res) {
          if (res.error) throw friendly(res.error);
          out = out.concat(res.data);
          return res.data.length === size ? page(from + size) : out;
        });
    }
    return page(0);
  }

  function loadAll() {
    return client().from('staff').select('id, name, role, active').order('name').then(function (res) {
      if (res.error) throw friendly(res.error);
      staff = res.data;
      var next = { schemaVersion: 1 };
      return Promise.all(L.COLLECTIONS.map(function (col) {
        return fetchAll(col).then(function (rows) { next[col] = rows.map(function (r) { return fromRow(col, r); }); });
      })).then(function () { cache = next; });
    });
  }

  /* 로그인 링크에서 돌아온 주소(?code= / #access_token= / #error=)를 읽는다 */
  function readAuthParams() {
    var out = {};
    [location.search.slice(1), location.hash.replace(/^#\/?/, '')].forEach(function (part) {
      part.split('&').forEach(function (kv) {
        var i = kv.indexOf('=');
        if (i > 0) { try { out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) { /* 무시 */ } }
      });
    });
    return out;
  }

  function cleanUrl() {
    var route = /^#\//.test(location.hash) ? location.hash : '';
    history.replaceState(null, '', location.pathname + route);
  }

  function authMessage(text) {
    if (/expired|invalid/i.test(text) && /otp|link|token/i.test(text)) return '로그인 링크가 만료되었거나 이미 사용되었습니다. 링크를 새로 받아 바로 눌러 주세요.';
    if (/verifier|flow state/i.test(text)) return '링크를 요청한 브라우저와 다른 곳에서 링크를 열었습니다. 이 브라우저에서 링크를 새로 받고, 같은 브라우저로 메일의 링크를 열어 주세요.';
    return '로그인하지 못했습니다: ' + text;
  }

  function handleAuthRedirect(c) {
    var p = readAuthParams();
    if (p.code) {
      return c.auth.exchangeCodeForSession(p.code).then(function (r) {
        cleanUrl();
        return r.error ? authMessage(r.error.message || String(r.error)) : null;
      });
    }
    if (p.access_token && p.refresh_token) {
      return c.auth.setSession({ access_token: p.access_token, refresh_token: p.refresh_token }).then(function (r) {
        cleanUrl();
        return r.error ? authMessage(r.error.message || String(r.error)) : null;
      });
    }
    if (p.error || p.error_description) {
      cleanUrl();
      return Promise.resolve(p.error_code === 'otp_expired' ? authMessage('otp expired') : authMessage(p.error_description || p.error));
    }
    return Promise.resolve(null);
  }

  function init() {
    var c, authError = null;
    try { c = client(); } catch (e) { return Promise.resolve({ state: 'error', mode: 'remote', message: e.message }); }
    return handleAuthRedirect(c).then(function (msg) {
      authError = msg;
      return c.auth.getSession();
    }).then(function (res) {
      var session = res.data && res.data.session;
      if (!session) return { state: 'signedOut', mode: 'remote', authError: authError };
      return c.from('staff').select('id, name, role, active, email').eq('user_id', session.user.id).maybeSingle().then(function (r) {
        if (r.error) throw friendly(r.error);
        if (!r.data || !r.data.active) return { state: 'notStaff', mode: 'remote', email: session.user.email };
        me = { staffId: r.data.id, name: r.data.name, role: r.data.role, email: r.data.email };
        return loadAll().then(function () { return { state: 'ready', mode: 'remote', me: me }; });
      });
    }).catch(function (e) { return { state: 'error', mode: 'remote', message: e.message }; });
  }

  function redirectUrl() { return location.origin + location.pathname; }

  function signInGoogle() {
    return client().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl() } })
      .then(function (res) { if (res.error) throw friendly(res.error); });
  }

  function signInPassword(email, password) {
    return client().auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      if (res.error) {
        if (/invalid login credentials/i.test(res.error.message)) throw new Error('이메일 또는 비밀번호가 맞지 않습니다.');
        if (/not confirmed/i.test(res.error.message)) throw new Error('아직 인증되지 않은 계정입니다. 관리자에게 “Auto Confirm User”로 계정을 다시 만들어 달라고 요청하세요.');
        throw friendly(res.error);
      }
    });
  }

  function signInEmail(email) {
    return client().auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirectUrl() } })
      .then(function (res) { if (res.error) throw friendly(res.error); });
  }

  function signOut() {
    return client().auth.signOut().then(function () { cache = null; me = null; });
  }

  function list(col, personId) {
    var arr = (cache && cache[col]) || [];
    return personId ? arr.filter(function (r) { return r.personId === personId; }) : arr.slice();
  }

  function get(col, id) {
    return ((cache && cache[col]) || []).filter(function (r) { return r.id === id; })[0] || null;
  }

  function upsert(col, rec) {
    var row = toRow(col, rec);
    // 관리코드는 서버가 매긴다(담당자는 다른 이용자의 번호를 볼 수 없다)
    if (col === 'persons' && !rec.id) delete row.code;
    var q = rec.id ? client().from(col).update(row).eq('id', rec.id) : client().from(col).insert(row);
    return q.select('*').single().then(function (res) {
      if (res.error) throw friendly(res.error);
      var saved = fromRow(col, res.data);
      var arr = cache[col];
      var i = arr.findIndex(function (r) { return r.id === saved.id; });
      if (i >= 0) arr[i] = saved; else arr.push(saved);
      return saved;
    });
  }

  /* 앱의 '삭제' = 서버의 보관 처리(관리자는 복구 가능) */
  function remove(col, id) {
    return client().rpc('archive_record', { p_table: col, p_id: id }).then(function (res) {
      if (res.error) throw friendly(res.error);
      cache[col] = cache[col].filter(function (r) { return r.id !== id; });
      if (col === 'persons') {
        L.COLLECTIONS.forEach(function (c) {
          if (c !== 'persons') cache[c] = cache[c].filter(function (r) { return r.personId !== id; });
        });
      }
    });
  }

  function counts() {
    var c = {};
    L.COLLECTIONS.forEach(function (k) { c[k] = list(k).length; });
    return c;
  }

  function exportJson() {
    var out = { schemaVersion: 1, exportedAt: new Date().toISOString() };
    L.COLLECTIONS.forEach(function (k) { out[k] = list(k); });
    return JSON.stringify(out, null, 2);
  }

  /* 백업 파일(또는 가상 샘플)을 서버로 옮긴다. 이용자를 먼저 넣고 새 id로 기록을 연결한다. */
  function importToServer(obj, onProgress) {
    var check = L.validateBackup(obj);
    if (!check.ok) return Promise.reject(new Error(check.errors.join(' / ')));
    var idMap = {}, result = { persons: 0, records: 0, errors: [] };
    var persons = obj.persons.slice();
    var byName = {};
    staff.forEach(function (s) { byName[s.name] = s.id; });

    function nextPerson(i) {
      if (i >= persons.length) return Promise.resolve();
      var p = persons[i];
      var row = toRow('persons', Object.assign({}, p, {
        // 담당자 이름이 직원 명단과 같으면 그 직원에게, 아니면 가져오는 사람에게 배정(담당자 역할은 항상 본인)
        workerId: me.role === 'worker' ? me.staffId : (byName[p.worker] || me.staffId),
        consent: p.consent !== false
      }));
      delete row.code;
      if (onProgress) onProgress('이용자 ' + (i + 1) + '/' + persons.length);
      return client().from('persons').insert(row).select('id').single().then(function (res) {
        if (res.error) result.errors.push('이용자 "' + p.name + '": ' + friendly(res.error).message);
        else { idMap[p.id] = res.data.id; result.persons++; }
        return nextPerson(i + 1);
      });
    }

    function insertChildren(cols, ci) {
      if (ci >= cols.length) return Promise.resolve();
      var col = cols[ci];
      var rows = obj[col].filter(function (r) { return idMap[r.personId]; }).map(function (r) {
        return toRow(col, Object.assign({}, r, { personId: idMap[r.personId] }));
      });
      var chunks = [];
      for (var i = 0; i < rows.length; i += 500) chunks.push(rows.slice(i, i + 500));
      if (onProgress) onProgress(col + ' ' + rows.length + '건');
      return chunks.reduce(function (p, chunk) {
        return p.then(function () {
          return client().from(col).insert(chunk).then(function (res) {
            if (res.error) result.errors.push(col + ': ' + friendly(res.error).message);
            else result.records += chunk.length;
          });
        });
      }, Promise.resolve()).then(function () { return insertChildren(cols, ci + 1); });
    }

    return nextPerson(0)
      .then(function () { return insertChildren(L.COLLECTIONS.slice(1), 0); })
      .then(loadAll)
      .then(function () { return result; });
  }

  /* AI 분석: 로그인 토큰을 함께 보내 서버가 직원 여부와 RLS 권한을 확인한다 */
  function aiAnalyze(personId) {
    return client().auth.getSession().then(function (res) {
      var token = res.data && res.data.session && res.data.session.access_token;
      if (!token) throw new Error('로그인이 만료되었습니다. 다시 로그인하세요.');
      return fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ personId: personId })
      });
    }).then(function (r) {
      return r.json().catch(function () { return { error: 'AI 서버 응답을 읽지 못했습니다(' + r.status + ').' }; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('AI 분석 실패 (' + r.status + ')'));
        return j;
      });
    }, function (e) {
      if (e instanceof TypeError) throw new Error('AI 서버에 연결할 수 없습니다.');
      throw e;
    });
  }

  function staffOptions() {
    return staff.filter(function (s) { return s.active; }).map(function (s) { return { value: s.id, label: s.name }; });
  }

  Object.assign(window.Store, {
    init: init, list: list, get: get, upsert: upsert, remove: remove, counts: counts, exportJson: exportJson,
    nextPersonCode: function () { return ''; },
    isRemote: function () { return true; },
    me: function () { return me; },
    staffOptions: staffOptions,
    signInGoogle: signInGoogle, signInEmail: signInEmail, signInPassword: signInPassword, signOut: signOut,
    importToServer: importToServer, reload: loadAll, aiAnalyze: aiAnalyze,
    isStorageOk: function () { return true; }
  });
})();
