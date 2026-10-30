/* =========================================================================
   Snowball · aplicación
   -------------------------------------------------------------------------
   • Router por hash con enlaces profundos (#/titulo/:id, #/ver/:id/:t/:e)
   • Catálogo remoto (catalog.json) con caché local y respaldo empaquetado
   • Progreso y favoritos en Supabase (o localStorage en modo invitado)
   • Reproductor mp4 / HLS / embed con reanudación y siguiente episodio
   • Comentarios por anime con RLS
   ========================================================================= */

(function () {
    'use strict';

    /* ===================================================================== */
    /* Configuración y referencias                                           */
    /* ===================================================================== */
    var CFG = window.SNOWBALL_CONFIG || {};
    var CATALOG = Array.isArray(window.CATALOG) ? window.CATALOG : [];

    var SB_AVAILABLE = typeof window.supabase !== 'undefined' && CFG.supabaseUrl && CFG.supabaseKey;
    var db = SB_AVAILABLE ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;

    var LS_FAV = 'snowball:favorites:v1';
    var LS_PROG = 'snowball:progress:v1';

    var TAB_HASH = { viewHome: '#/', viewExplore: '#/explorar', viewList: '#/mi-lista' };
    var HASH_TAB = { '': 'viewHome', 'explorar': 'viewExplore', 'mi-lista': 'viewList' };

    var video = document.getElementById('mainVideo');

    var state = {
        user: null,
        displayName: null,
        favorites: new Set(),
        progress: new Map(),      // episodeId -> { animeId, seasonId, episodeId, position, duration, updatedAt }
        anime: null,
        seasonIndex: 0,
        episode: null,
        episodeKey: null,
        hls: null,
        resumeApplied: false,
        lastSaveAt: 0,
        autoNextTimer: null,
        commentsFor: null,
        avatarUrl: null,
        genre: 'Todos',
        query: '',
        tab: 'viewHome',
        playerReturn: '#/',
        migrated: false,
        authReady: false
    };

    /* ===================================================================== */
    /* Utilidades                                                            */
    /* ===================================================================== */
    function $(id) { return document.getElementById(id); }

    function escapeHtml(text) {
        var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text == null ? '' : text).replace(/[&<>"']/g, function (m) { return map[m]; });
    }

    function setBg(el, url) {
        if (!el) return;
        el.style.backgroundImage = 'url("' + String(url || '').replace(/"/g, '%22') + '")';
    }

    function toast(message, type, duration) {
        var stack = $('toastStack');
        if (!stack) return;
        var el = document.createElement('div');
        el.className = 'toast ' + (type || 'info');
        el.textContent = message;
        stack.appendChild(el);
        var life = duration || 3200;
        setTimeout(function () {
            el.classList.add('out');
            el.addEventListener('animationend', function () { el.remove(); }, { once: true });
            setTimeout(function () { el.remove(); }, 400);
        }, life);
    }

    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        var m = Math.floor(seconds / 60);
        var s = Math.floor(seconds % 60);
        return m + ':' + String(s).padStart(2, '0');
    }

    function timeAgo(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        var diff = (Date.now() - date.getTime()) / 1000;
        if (diff < 60) return 'ahora';
        if (diff < 3600) return 'hace ' + Math.floor(diff / 60) + ' min';
        if (diff < 86400) return 'hace ' + Math.floor(diff / 3600) + ' h';
        if (diff < 604800) return 'hace ' + Math.floor(diff / 86400) + ' d';
        return date.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function initialsOf(name) {
        var clean = String(name || '').trim();
        if (!clean) return '?';
        var parts = clean.split(/\s+/).filter(Boolean);
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function readLocal(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (err) {
            return fallback;
        }
    }

    function writeLocal(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* modo privado */ }
    }

    function minutesLabel(seconds) {
        var min = Math.round((Number(seconds) || 0) / 60);
        return min > 0 ? min + ' min' : '—';
    }

    /* ===================================================================== */
    /* Catálogo                                                              */
    /* ===================================================================== */
    function findAnime(id) {
        for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].id === id) return CATALOG[i];
        return null;
    }

    /* ------------------------- catálogo remoto -------------------------- */
    /* El catálogo incluido en js/data/catalog.js es el respaldo (offline y
       primer arranque). Si CFG.catalogUrl apunta a un JSON, la app lo pide al
       abrirse y sustituye los datos sin recompilar nada. */
    var catalogSync = { loading: false, lastAt: 0 };

    function remoteCatalogUrl() {
        if (!CFG.catalogUrl) return '';
        // file:// no permite leer otros archivos por CORS: se usa el incluido
        if (location.protocol === 'file:') return '';
        return CFG.catalogUrl;
    }

    // Acepta tanto un array como { version, updatedAt, animes: [...] }
    function normalizeCatalog(payload) {
        var list = Array.isArray(payload)
            ? payload
            : (payload && Array.isArray(payload.animes) ? payload.animes : null);

        if (!list) return null;

        var valid = list.filter(function (anime) {
            return anime && typeof anime === 'object' && anime.id && anime.title &&
                Array.isArray(anime.seasons) && anime.seasons.length;
        });

        if (valid.length !== list.length) {
            console.warn('[catálogo remoto] ' + (list.length - valid.length) + ' anime(s) ignorados por datos incompletos');
        }

        return valid.length ? valid : null;
    }

    function readCatalogCache() {
        var cached = readLocal(CFG.catalogCacheKey || 'snowball.catalog.v1', null);
        if (!cached) return null;
        return normalizeCatalog(cached.data || cached);
    }

    function saveCatalogCache(list) {
        writeLocal(CFG.catalogCacheKey || 'snowball.catalog.v1', {
            savedAt: Date.now(),
            data: list
        });
    }

    function replaceCatalog(list) {
        CATALOG.length = 0;
        Array.prototype.push.apply(CATALOG, list);
    }

    function refreshCatalogUI() {
        renderHome();
        renderChips();
        renderCatalog();
        renderFavorites();
        renderContinueShelf();

        // Si hay una ficha abierta, se repinta con los datos nuevos
        if (state.anime) {
            var fresh = findAnime(state.anime.id);
            if (fresh) {
                renderDetail(fresh, state.seasonIndex);
            } else if ($('detailScreen').classList.contains('active')) {
                closeDetailUI();
                go('#/');
                toast('Ese anime ya no está disponible.', 'err', 5000);
            }
        }
    }

    function applyCatalog(list, silent) {
        // Comparación barata para no repintar si el JSON no cambió
        if (JSON.stringify(list) === JSON.stringify(CATALOG)) return false;

        replaceCatalog(list);
        if (!silent) refreshCatalogUI();
        return true;
    }

    async function syncCatalog(options) {
        var opts = options || {};
        var url = remoteCatalogUrl();
        if (!url || catalogSync.loading) return false;

        catalogSync.loading = true;
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = setTimeout(function () {
            if (controller) controller.abort();
        }, CFG.catalogTimeoutMs || 8000);

        try {
            var res = await fetch(url, {
                cache: 'no-cache', // revalida con el servidor, pero aprovecha ETag/CDN
                signal: controller ? controller.signal : undefined
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);

            var payload = await res.json();
            var list = normalizeCatalog(payload);
            if (!list) throw new Error('el JSON no contiene una lista "animes" válida');

            if (window.validateCatalog) window.validateCatalog(list);

            var changed = applyCatalog(list);
            saveCatalogCache(list);
            catalogSync.lastAt = Date.now();

            if (changed) {
                console.info('[catálogo] actualizado: ' + list.length + ' animes');
                if (opts.announce) toast('Catálogo actualizado', 'ok', 2500);
            }
            return changed;
        } catch (err) {
            console.warn('[catálogo remoto] ' + (err.message || err));
            if (opts.announce) {
                toast('No se pudo actualizar el catálogo. Se usa la copia guardada.', 'err', 4500);
            }
            return false;
        } finally {
            clearTimeout(timer);
            catalogSync.loading = false;
        }
    }

    function findSeasonIndex(anime, seasonId) {
        if (!anime || !anime.seasons) return 0;
        for (var i = 0; i < anime.seasons.length; i++) if (anime.seasons[i].id === seasonId) return i;
        return 0;
    }

    function nextEpisode(anime, seasonId, episodeId) {
        if (!anime) return null;
        var flat = [];
        (anime.seasons || []).forEach(function (season, sIdx) {
            (season.episodes || []).forEach(function (ep, eIdx) {
                flat.push({ season: season, episode: ep, seasonIndex: sIdx, episodeIndex: eIdx });
            });
        });
        for (var i = 0; i < flat.length; i++) {
            if (flat[i].episode.id === episodeId) return flat[i + 1] || null;
        }
        return null;
    }

    function progressOf(episodeId) {
        return state.progress.get(episodeId) || null;
    }

    function ratioOf(episodeId) {
        var rec = progressOf(episodeId);
        if (!rec || !rec.duration) return 0;
        return Math.min(1, (Number(rec.position) || 0) / Number(rec.duration));
    }

    function continueEntries(limit) {
        var rows = Array.from(state.progress.values())
            .filter(function (r) { return r && r.animeId && r.episodeId; })
            .sort(function (a, b) { return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0); });

        var seen = Object.create(null);
        var out = [];

        rows.forEach(function (row) {
            if (seen[row.animeId]) return;
            var anime = findAnime(row.animeId);
            if (!anime || !anime.seasons || !anime.seasons.length) return;

            var sIdx = findSeasonIndex(anime, row.seasonId);
            var season = anime.seasons[sIdx];
            var eIdx = -1;
            for (var i = 0; i < season.episodes.length; i++) {
                if (season.episodes[i].id === row.episodeId) { eIdx = i; break; }
            }
            if (eIdx < 0) return;

            seen[row.animeId] = true;
            out.push({
                anime: anime,
                season: season,
                episode: season.episodes[eIdx],
                seasonIndex: sIdx,
                episodeIndex: eIdx,
                ratio: row.duration ? Math.min(1, row.position / row.duration) : 0
            });
        });

        return out.slice(0, limit || 10);
    }

    /* ===================================================================== */
    /* Datos del usuario: favoritos y progreso                               */
    /* ===================================================================== */
    function isMissingTableOrColumn(error) {
        if (!error) return false;
        var code = error.code || '';
        var msg = String(error.message || '');
        return code === '42P01' || code === '42703' || code === 'PGRST205' ||
               /does not exist|no existe|schema cache/i.test(msg);
    }

    async function loadFavorites() {
        var local = readLocal(LS_FAV, []);
        state.favorites = new Set(Array.isArray(local) ? local : []);

        if (db && state.user) {
            try {
                var res = await db.from('favorites').select('anime_id').eq('user_id', state.user.id);
                if (res.error) throw res.error;
                state.favorites = new Set((res.data || []).map(function (r) { return r.anime_id; }));
            } catch (err) {
                console.warn('[favoritos]', err.message || err);
                if (isMissingTableOrColumn(err)) toast('Falta la tabla "favorites". Ejecuta sql/schema.sql.', 'err', 6000);
            }
        }

        renderFavorites();
        updateFavButtonState();
    }

    async function loadProgress() {
        var local = readLocal(LS_PROG, {});
        var map = new Map();
        Object.keys(local || {}).forEach(function (key) {
            var value = local[key];
            if (value && value.episodeId) map.set(key, value);
        });
        state.progress = map;

        if (db && state.user) {
            try {
                var res = await db.from('progress')
                    .select('anime_id, season_id, episode_id, position, duration, updated_at')
                    .eq('user_id', state.user.id)
                    .order('updated_at', { ascending: false })
                    .limit(200);
                if (res.error) throw res.error;

                var cloud = new Map();
                (res.data || []).forEach(function (r) {
                    cloud.set(r.episode_id, {
                        animeId: r.anime_id,
                        seasonId: r.season_id,
                        episodeId: r.episode_id,
                        position: Number(r.position) || 0,
                        duration: Number(r.duration) || 0,
                        updatedAt: r.updated_at
                    });
                });
                state.progress = cloud;
            } catch (err) {
                console.warn('[progreso]', err.message || err);
                if (isMissingTableOrColumn(err)) toast('Falta la tabla "progress". Ejecuta sql/schema.sql.', 'err', 6000);
            }
        }

        renderContinueShelf();
        renderEpisodes();
    }

    function persistProgressRecord(record) {
        state.progress.set(record.episodeId, record);

        // El almacenamiento local es solo para invitados: si hay sesión, la
        // fuente de verdad es Supabase y así no se mezclan cuentas distintas
        // que usen el mismo navegador.
        if (!state.user) {
            var guest = readLocal(LS_PROG, {});
            guest[record.episodeId] = record;
            writeLocal(LS_PROG, guest);
        }
    }

    async function saveProgress() {
        if (!state.episode || state.episode.type === 'embed') return;
        if (!video.duration || !isFinite(video.duration)) return;

        var position = video.currentTime;
        if (!position || position < (CFG.progressMinSeconds || 5)) return;

        var record = {
            animeId: state.episode.animeId,
            seasonId: state.episode.seasonId,
            episodeId: state.episode.episodeId,
            position: position,
            duration: video.duration,
            updatedAt: new Date().toISOString()
        };

        persistProgressRecord(record);

        if (db && state.user) {
            try {
                await db.from('progress').upsert({
                    user_id: state.user.id,
                    anime_id: record.animeId,
                    season_id: record.seasonId,
                    episode_id: record.episodeId,
                    position: Math.round(position),
                    duration: Math.round(video.duration),
                    updated_at: record.updatedAt
                }, { onConflict: 'user_id,episode_id' });
            } catch (err) {
                console.warn('[guardar progreso]', err.message || err);
            }
        }

        // Mantén la estantería al día si se está viendo en el mini reproductor
        if (state.tab === 'viewHome' &&
            !$('fullPlayer').classList.contains('active') &&
            $('viewHome').classList.contains('active')) {
            renderContinueShelf();
        }
    }

    async function toggleFavorite(animeId) {
        var isFav = state.favorites.has(animeId);

        if (isFav) {
            state.favorites.delete(animeId);
            toast('Quitado de Mi lista');
        } else {
            state.favorites.add(animeId);
            toast('Añadido a Mi lista', 'ok');
        }

        renderFavorites();
        updateFavButtonState();

        var local = Array.from(state.favorites);
        if (!state.user) writeLocal(LS_FAV, local);

        if (db && state.user) {
            try {
                if (isFav) {
                    var del = await db.from('favorites').delete()
                        .eq('user_id', state.user.id)
                        .eq('anime_id', animeId);
                    if (del.error) throw del.error;
                } else {
                    var ins = await db.from('favorites').upsert(
                        { user_id: state.user.id, anime_id: animeId },
                        { onConflict: 'user_id,anime_id' }
                    );
                    if (ins.error) throw ins.error;
                }
            } catch (err) {
                console.warn('[favoritos]', err.message || err);
                toast('No se pudo sincronizar la lista: ' + (err.message || err), 'err', 5000);
            }
        }
    }

    async function migrateGuestData() {
        if (!db || !state.user || state.migrated) return;
        state.migrated = true;

        var favs = readLocal(LS_FAV, []);
        var prog = readLocal(LS_PROG, {});
        var progressRows = Object.keys(prog || {}).map(function (key) {
            var p = prog[key];
            return {
                user_id: state.user.id,
                anime_id: p.animeId,
                season_id: p.seasonId,
                episode_id: p.episodeId,
                position: Math.round(p.position || 0),
                duration: Math.round(p.duration || 0),
                updated_at: p.updatedAt || new Date().toISOString()
            };
        }).filter(function (r) { return r.anime_id && r.episode_id; });

        if (!favs.length && !progressRows.length) return;

        try {
            if (favs.length) {
                await db.from('favorites').upsert(
                    favs.map(function (id) { return { user_id: state.user.id, anime_id: id }; }),
                    { onConflict: 'user_id,anime_id', ignoreDuplicates: true }
                );
            }
            if (progressRows.length) {
                await db.from('progress').upsert(progressRows, {
                    onConflict: 'user_id,episode_id',
                    ignoreDuplicates: true
                });
            }
            localStorage.removeItem(LS_FAV);
            localStorage.removeItem(LS_PROG);
            toast('Tu lista y tu progreso se sincronizaron con tu cuenta', 'ok');
        } catch (err) {
            console.warn('[migración]', err.message || err);
        }
    }

    /* ===================================================================== */
    /* Autenticación                                                         */
    /* ===================================================================== */
    function nameFromUser(user) {
        var meta = (user && user.user_metadata) || {};
        return meta.full_name || meta.name || (user && user.email ? user.email.split('@')[0] : 'Usuario');
    }

    // Foto de perfil de Google (viene en los metadatos de la sesión)
    function avatarUrlFromUser(user) {
        var meta = (user && user.user_metadata) || {};
        var url = meta.avatar_url || meta.picture || '';
        return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : '';
    }

    function renderHeaderUser() {
        var btn = $('userProfileBtn');
        if (!btn) return;

        if (!state.user) {
            state.displayName = null;
            state.avatarUrl = null;
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
                '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5z"/></svg>';
            btn.setAttribute('aria-label', 'Iniciar sesión');
            return;
        }

        state.displayName = state.displayName || nameFromUser(state.user);
        var url = state.avatarUrl || avatarUrlFromUser(state.user);

        if (url) {
            btn.innerHTML = '<img src="' + escapeHtml(url) + '" alt="" referrerpolicy="no-referrer">';
            var img = btn.querySelector('img');
            if (img) {
                img.addEventListener('error', function () {
                    btn.textContent = initialsOf(state.displayName || 'U');
                });
            }
        } else {
            btn.textContent = initialsOf(state.displayName);
        }
        btn.setAttribute('aria-label', 'Perfil de ' + state.displayName);
    }

    function initAuth() {
        if (!db) {
            console.warn('Supabase no disponible: la app funciona en modo invitado.');
            return;
        }

        db.auth.onAuthStateChange(function (_event, session) {
            applySession(session);
        });

        db.auth.getSession().then(function (res) {
            if (res.error) throw res.error;
            applySession(res.data.session);
        }).catch(function (err) {
            console.warn('[sesión]', err.message || err);
            toast('No se pudo comprobar la sesión. Sigues en modo invitado.', 'err', 4500);
        });
    }

    function applySession(session) {
        var previousId = state.user ? state.user.id : null;
        state.user = session && session.user ? session.user : null;
        var nextId = state.user ? state.user.id : null;

        // onAuthStateChange y getSession pueden disparar dos veces seguidas
        if (state.authReady && previousId === nextId) return;
        state.authReady = true;

        if (!nextId) {
            state.displayName = null;
            state.avatarUrl = null;
        } else {
            state.avatarUrl = avatarUrlFromUser(state.user);
        }
        renderHeaderUser();

        state.migrated = false;

        (async function () {
            if (nextId) {
                await migrateGuestData();
                await syncProfileAvatar();
            }
            await loadFavorites();
            await loadProgress();
            renderHomeShelves();
            if (state.anime) {
                updateFavButtonState();
                if ($('detailScreen').classList.contains('active')) loadComments(state.anime.id);
            }
        })();
    }

    // Guarda la foto de Google en el perfil para que se vea en los comentarios
    async function syncProfileAvatar() {
        if (!db || !state.user) return;

        var url = avatarUrlFromUser(state.user);
        if (!url) return;

        try {
            var res = await db.from('profiles')
                .update({ avatar_url: url })
                .eq('id', state.user.id);
            if (res.error) console.warn('[avatar]', res.error.message);
        } catch (err) {
            console.warn('[avatar]', err.message || err);
        }
    }

    async function loginWithGoogle() {
        if (!db) {
            toast('Falta configurar Supabase en js/config.js', 'err', 5000);
            return;
        }
        if (location.protocol === 'file:') {
            toast('Google necesita http:// o https://. Abre la web desde un servidor o tu hosting.', 'err', 6000);
            return;
        }

        var btn = $('googleLoginBtn');
        btn.disabled = true;
        btn.textContent = 'Conectando...';

        try {
            var res = await db.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: location.origin + location.pathname }
            });
            if (res.error) throw res.error;
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Continuar con Google';
            toast('Error al conectar con Google: ' + (err.message || err), 'err', 5000);
        }
    }

    function openLoginModal() {
        if (!state.user) {
            $('loginModal').classList.add('active');
            return;
        }
        openProfileModal();
    }

    function closeLoginModal() {
        $('loginModal').classList.remove('active');
    }

    async function openProfileModal() {
        if (!state.user) return;

        var name = nameFromUser(state.user);
        var avatarUrl = avatarUrlFromUser(state.user);
        var hasAvatarColumn = false;

        if (db) {
            try {
                var res = await db.from('profiles').select('username, avatar_url').eq('id', state.user.id).maybeSingle();

                // Instalaciones sin la migración de avatares: seguimos funcionando con lo básico
                if (res.error && isMissingTableOrColumn(res.error)) {
                    res = await db.from('profiles').select('username').eq('id', state.user.id).maybeSingle();
                } else if (!res.error) {
                    hasAvatarColumn = true;
                }
                if (res.error) throw res.error;

                var profile = res.data || null;

                if (profile && profile.username) {
                    name = profile.username;
                } else {
                    var fallback = String(name || 'usuario').slice(0, 20).trim();
                    if (fallback.length < 3) fallback = 'usuario';
                    var payload = { id: state.user.id, username: fallback };
                    if (hasAvatarColumn) payload.avatar_url = avatarUrl || null;
                    var created = await db.from('profiles')
                        .upsert(payload, { onConflict: 'id' });
                    if (created.error) console.warn('[perfil]', created.error.message);
                    else name = fallback;
                }

                if (profile && profile.avatar_url) avatarUrl = profile.avatar_url;
            } catch (err) {
                console.warn('[perfil]', err.message || err);
                toast('No se pudo cargar tu perfil. Se usa el nombre de Google.', 'err', 4200);
            }
        }

        state.avatarUrl = avatarUrl;
        state.displayName = name;
        renderHeaderUser();

        var avatar = $('profileAvatar');
        avatar.innerHTML = avatarUrl
            ? '<img src="' + escapeHtml(avatarUrl) + '" alt="" referrerpolicy="no-referrer">'
            : escapeHtml(initialsOf(name));

        $('profileEmail').textContent = state.user.email || '';
        $('profileNameDisplay').textContent = name;
        $('editNameInput').value = name;
        $('profileErrorMsg').style.display = 'none';
        $('profileModal').classList.add('active');
    }

    function closeProfileModal() {
        $('profileErrorMsg').style.display = 'none';
        $('profileModal').classList.remove('active');
    }

    async function saveProfileChanges() {
        if (!state.user || !db) return;

        var input = $('editNameInput');
        var errorEl = $('profileErrorMsg');
        var btn = $('saveProfileBtn');
        var newName = input.value.trim();

        errorEl.style.display = 'none';

        if (!newName) {
            return showProfileError('El nombre no puede estar vacío.');
        }
        if (newName.length < 3) {
            return showProfileError('Usa al menos 3 caracteres.');
        }
        if (!/^[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ ._-]+$/.test(newName)) {
            return showProfileError('Solo letras, números, espacios, puntos, guiones y guion bajo.');
        }

        btn.disabled = true;
        btn.textContent = 'Guardando...';

        var res = await db.from('profiles').upsert({ id: state.user.id, username: newName }, { onConflict: 'id' });

        btn.disabled = false;
        btn.textContent = 'Guardar cambios';

        if (res.error) {
            return showProfileError(res.error.code === '23505'
                ? 'Ese nombre de usuario ya está en uso.'
                : 'Error al actualizar: ' + res.error.message);
        }

        state.displayName = newName;
        renderHeaderUser();
        $('profileNameDisplay').textContent = newName;
        closeProfileModal();
        toast('Perfil actualizado', 'ok');
        if (state.anime) loadComments(state.anime.id);

        function showProfileError(message) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    async function logoutUser() {
        if (db) {
            var res = await db.auth.signOut();
            if (res.error) {
                toast('No se pudo cerrar sesión: ' + res.error.message, 'err');
                return;
            }
        }
        state.user = null;
        state.displayName = null;
        state.avatarUrl = null;
        renderHeaderUser();
        closeProfileModal();
        await loadFavorites();
        await loadProgress();
        renderHomeShelves();
        toast('Sesión cerrada', 'ok');
    }

    /* ===================================================================== */
    /* Router                                                                */
    /* ===================================================================== */
    function go(hash) {
        if (location.hash === hash) {
            handleRoute();
            return;
        }
        location.hash = hash;
    }

    function handleRoute() {
        var raw = location.hash.replace(/^#\/?/, '');
        var parts = raw.split('/').filter(Boolean);

        if (parts[0] === 'titulo' && parts[1]) {
            hidePlayerUI();
            openDetailRoute(decodeURIComponent(parts[1]));
            return;
        }

        if (parts[0] === 'ver' && parts[1] && parts[2] && parts[3]) {
            openPlayerRoute(decodeURIComponent(parts[1]), parts[2], parts[3]);
            return;
        }

        hidePlayerUI();
        closeDetailUI();
        setTab(HASH_TAB[parts[0] || ''] || 'viewHome');
    }

    function setTab(viewId) {
        document.querySelectorAll('.app-view').forEach(function (view) { view.classList.remove('active'); });
        document.querySelectorAll('.tab-bar .tab').forEach(function (tab) { tab.classList.remove('active'); });

        var view = $(viewId);
        if (view) view.classList.add('active');

        var tab = document.querySelector('.tab[data-view="' + viewId + '"]');
        if (tab) tab.classList.add('active');

        var TITLES = {
            viewHome: 'Snowball',
            viewExplore: 'Explorar · Snowball',
            viewList: 'Mi lista · Snowball'
        };
        document.title = TITLES[viewId] || 'Snowball';

        state.tab = viewId;
        $('views').scrollTop = 0;

        // El progreso puede haber cambiado mientras estaba el reproductor abierto
        if (viewId === 'viewHome') renderContinueShelf();
    }

    function switchTab(viewId) {
        go(TAB_HASH[viewId] || '#/');
    }

    function goExplore() {
        go('#/explorar');
    }

    function closeDetail() {
        go(TAB_HASH[state.tab] || '#/');
    }

    function closeDetailUI() {
        var screen = $('detailScreen');
        if (screen) {
            screen.classList.remove('active');
            screen.setAttribute('aria-hidden', 'true');
        }
        state.anime = null;
        state.commentsFor = null;
    }

    /* ===================================================================== */
    /* Inicio                                                                */
    /* ===================================================================== */
    function renderHomeShelves() {
        renderContinueShelf();
        renderTrendingShelf();
        renderNewShelf();
    }

    function renderHome() {
        var hero = CATALOG.filter(function (a) { return a.featured; })[0] || CATALOG[0];
        if (!hero) return;

        $('heroTitle').textContent = hero.title;
        $('heroMeta').textContent = hero.genres.join(' · ') + ' · ' + hero.year;
        setBg($('heroCard'), hero.banner || hero.poster);

        function openHero() { go('#/titulo/' + encodeURIComponent(hero.id)); }

        $('heroCard').onclick = openHero;
        $('heroPlayBtn').onclick = function (e) {
            e.stopPropagation();
            openHero();
        };

        renderHomeShelves();
    }

    function makeAlbumCard(anime, options) {
        var opts = options || {};
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'album';
        card.setAttribute('aria-label', 'Abrir ' + anime.title);

        var art = document.createElement('div');
        art.className = 'album-art';
        setBg(art, anime.poster || anime.banner);

        var play = document.createElement('span');
        play.className = 'album-play';
        play.textContent = '▶';
        play.setAttribute('aria-hidden', 'true');
        art.appendChild(play);

        var title = document.createElement('div');
        title.className = 'album-title';
        title.textContent = anime.title;

        var sub = document.createElement('div');
        sub.className = 'album-sub';
        sub.textContent = opts.subtitle || anime.genres.slice(0, 2).join(' · ');

        card.appendChild(art);
        card.appendChild(title);
        card.appendChild(sub);

        if (typeof opts.ratio === 'number' && opts.ratio > 0) {
            var bar = document.createElement('div');
            bar.className = 'album-progress';
            var fill = document.createElement('span');
            fill.style.width = Math.round(Math.min(1, opts.ratio) * 100) + '%';
            bar.appendChild(fill);
            card.appendChild(bar);
        }

        card.addEventListener('click', function () {
            if (opts.onOpen) opts.onOpen();
            else go('#/titulo/' + encodeURIComponent(anime.id));
        });

        return card;
    }

    function renderContinueShelf() {
        var shelf = $('rowContinue');
        if (!shelf) return;
        shelf.innerHTML = '';

        var entries = continueEntries(10);

        if (!entries.length) {
            var empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.style.minWidth = '100%';
            empty.innerHTML = '<span class="emoji">🍿</span>Aquí aparecerá lo que estés viendo.<br>Empieza un episodio y lo retomamos por ti.';
            shelf.appendChild(empty);
            return;
        }

        entries.forEach(function (entry) {
            var card = makeAlbumCard(entry.anime, {
                subtitle: 'T' + entry.season.number + ' E' + entry.episode.number,
                ratio: entry.ratio,
                onOpen: function () {
                    playEpisode(entry.anime, entry.seasonIndex, entry.episodeIndex);
                }
            });
            shelf.appendChild(card);
        });
    }

    function renderTrendingShelf() {
        var shelf = $('rowTrending');
        if (!shelf) return;
        shelf.innerHTML = '';

        var items = CATALOG.filter(function (a) { return a.trending; });
        if (!items.length) items = CATALOG.slice(0, 4);

        items.forEach(function (anime) { shelf.appendChild(makeAlbumCard(anime)); });
    }

    function renderNewShelf() {
        var shelf = $('rowNew');
        if (!shelf) return;
        shelf.innerHTML = '';

        CATALOG.slice()
            .sort(function (a, b) { return (b.year || 0) - (a.year || 0); })
            .slice(0, 8)
            .forEach(function (anime) {
                shelf.appendChild(makeAlbumCard(anime, {
                    subtitle: anime.studio + ' · ' + anime.year
                }));
            });
    }

    /* ===================================================================== */
    /* Explorar                                                              */
    /* ===================================================================== */
    function makeBrowseCard(anime) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'browse-card';
        setBg(card, anime.poster || anime.banner);
        card.setAttribute('aria-label', 'Abrir ' + anime.title);

        var title = document.createElement('span');
        title.className = 'browse-title';
        title.textContent = anime.title;

        var sub = document.createElement('span');
        sub.className = 'browse-sub';
        sub.textContent = anime.year + ' · ' + anime.genres.slice(0, 2).join(' · ');

        card.appendChild(title);
        card.appendChild(sub);
        card.addEventListener('click', function () { go('#/titulo/' + encodeURIComponent(anime.id)); });
        return card;
    }

    function renderChips() {
        var genres = ['Todos'];
        CATALOG.forEach(function (anime) {
            (anime.genres || []).forEach(function (genre) {
                if (genres.indexOf(genre) === -1) genres.push(genre);
            });
        });

        var wrap = $('genreChips');
        wrap.innerHTML = '';

        genres.forEach(function (genre) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip' + (state.genre === genre ? ' active' : '');
            chip.textContent = genre;
            chip.addEventListener('click', function () {
                state.genre = genre;
                renderChips();
                renderCatalog();
            });
            wrap.appendChild(chip);
        });
    }

    function renderCatalog() {
        var grid = $('searchGrid');
        if (!grid) return;

        var query = state.query.trim().toLowerCase();

        var results = CATALOG.filter(function (anime) {
            var genres = anime.genres || [];
            var matchGenre = state.genre === 'Todos' || genres.indexOf(state.genre) > -1;
            var haystack = [anime.title, anime.originalTitle, anime.studio, anime.meta]
                .concat(genres).join(' ').toLowerCase();
            return matchGenre && (!query || haystack.indexOf(query) > -1);
        });

        $('catalogCount').textContent = String(results.length);
        grid.innerHTML = '';

        if (!results.length) {
            var empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.style.gridColumn = 'span 2';
            empty.innerHTML = '<span class="emoji">🔍</span>Sin resultados' +
                (query ? ' para “' + escapeHtml(state.query) + '”' : '') +
                '.<br>Prueba con otro título o género.';
            grid.appendChild(empty);
            return;
        }

        results.forEach(function (anime) { grid.appendChild(makeBrowseCard(anime)); });
    }

    /* ===================================================================== */
    /* Mi lista                                                              */
    /* ===================================================================== */
    function makeRow(anime) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'row';
        row.setAttribute('aria-label', 'Abrir ' + anime.title);

        var art = document.createElement('div');
        art.className = 'row-art';
        setBg(art, anime.poster || anime.banner);

        var text = document.createElement('div');
        text.className = 'row-text';

        var title = document.createElement('div');
        title.className = 'row-title';
        title.textContent = anime.title;

        var sub = document.createElement('div');
        sub.className = 'row-sub';
        sub.textContent = anime.genres.join(' · ') + ' · ' + anime.year;

        text.appendChild(title);
        text.appendChild(sub);

        var chevron = document.createElement('span');
        chevron.className = 'row-chevron';
        chevron.textContent = '›';
        chevron.setAttribute('aria-hidden', 'true');

        row.appendChild(art);
        row.appendChild(text);
        row.appendChild(chevron);

        row.addEventListener('click', function () { go('#/titulo/' + encodeURIComponent(anime.id)); });
        return row;
    }

    function renderFavorites() {
        var wrap = $('favoritesGrid');
        if (!wrap) return;

        var list = CATALOG.filter(function (anime) { return state.favorites.has(anime.id); });
        var count = list.length;

        $('favCount').textContent = String(count);

        var badge = $('navFavBadge');
        badge.textContent = String(count);
        badge.classList.toggle('visible', count > 0);

        wrap.innerHTML = '';

        if (!count) {
            var empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = '<span class="emoji">🍿</span>Tu lista está vacía.<br>Abre una ficha y pulsa «Mi lista».' +
                '<br><button class="empty-action" type="button">Explorar catálogo</button>';
            var btn = empty.querySelector('.empty-action');
            if (btn) btn.addEventListener('click', goExplore);
            wrap.appendChild(empty);
            return;
        }

        var group = document.createElement('div');
        group.className = 'group';
        list.forEach(function (anime) { group.appendChild(makeRow(anime)); });
        wrap.appendChild(group);
    }

    /* ===================================================================== */
    /* Detalle                                                               */
    /* ===================================================================== */
    function openDetailRoute(animeId) {
        var anime = findAnime(animeId);
        if (!anime) {
            toast('Ese anime no está en el catálogo', 'err');
            go('#/');
            return;
        }

        renderDetail(anime, 0);

        var screen = $('detailScreen');
        screen.classList.add('active');
        screen.setAttribute('aria-hidden', 'false');
        screen.scrollTop = 0;

        loadComments(anime.id);
    }

    function renderDetail(anime, seasonIndex) {
        if (!anime || !anime.seasons || !anime.seasons.length) return;

        state.anime = anime;
        state.seasonIndex = Math.min(Math.max(seasonIndex || 0, 0), anime.seasons.length - 1);

        var hero = $('detailHero');
        hero.style.setProperty('--art', 'url("' + String(anime.banner || anime.poster).replace(/"/g, '%22') + '")');

        setBg($('detailArt'), anime.poster || anime.banner);
        $('detailTitle').textContent = anime.title;
        document.title = anime.title + ' · Snowball';

        var meta = $('detailMeta');
        meta.innerHTML = '';
        var accent = document.createElement('span');
        accent.className = 'accent';
        accent.textContent = (anime.genres || []).join(' · ');
        meta.appendChild(accent);
        meta.appendChild(document.createTextNode(' · ' + anime.year + ' · ' + anime.studio));

        var tags = $('detailTags');
        tags.innerHTML = '';
        [
            anime.status,
            anime.ageRating,
            '★ ' + anime.rating,
            (anime.seasons.length > 1 ? anime.seasons.length + ' temporadas' : '1 temporada')
        ].forEach(function (label) {
            if (!label) return;
            var tag = document.createElement('span');
            tag.className = 'tag';
            tag.textContent = label;
            tags.appendChild(tag);
        });

        $('detailSynopsis').textContent = anime.synopsis;

        $('detailPlayBtn').onclick = function () {
            var index = firstPlayableEpisode(anime, state.seasonIndex);
            playEpisode(anime, state.seasonIndex, index);
        };

        updateFavButtonState();
        renderSeasons();
        renderEpisodes();
    }

    function firstPlayableEpisode(anime, seasonIndex) {
        var season = anime.seasons[seasonIndex];
        if (!season) return 0;
        for (var i = 0; i < season.episodes.length; i++) {
            if (ratioOf(season.episodes[i].id) < 0.92) return i;
        }
        return 0;
    }

    function renderSeasons() {
        var wrap = $('seasonTabs');
        if (!wrap) return;
        wrap.innerHTML = '';

        (state.anime.seasons || []).forEach(function (season, index) {
            var tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'season-tab' + (index === state.seasonIndex ? ' active' : '');
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', index === state.seasonIndex ? 'true' : 'false');
            tab.title = season.title || ('Temporada ' + season.number);
            tab.textContent = 'T' + season.number;
            tab.addEventListener('click', function () {
                if (state.seasonIndex === index) return;
                state.seasonIndex = index;
                renderSeasons();
                renderEpisodes();
            });
            wrap.appendChild(tab);
        });
    }

    function renderEpisodes() {
        var list = $('episodesList');
        if (!list || !state.anime) return;

        var season = state.anime.seasons[state.seasonIndex];
        if (!season) return;

        $('episodesCount').textContent = String(season.episodes.length);
        list.innerHTML = '';

        season.episodes.forEach(function (ep, index) {
            var ratio = ratioOf(ep.id);
            var done = ratio >= 0.92;

            var item = document.createElement('button');
            item.type = 'button';
            item.className = 'ep-item';

            var thumb = document.createElement('div');
            thumb.className = 'ep-thumb';
            setBg(thumb, ep.thumb || state.anime.banner || state.anime.poster);

            var body = document.createElement('div');
            body.className = 'ep-body';

            var title = document.createElement('div');
            title.className = 'ep-title';
            title.textContent = ep.number + '. ' + ep.title;

            var sub = document.createElement('div');
            sub.className = 'ep-sub';
            sub.textContent = 'T' + season.number + ' E' + ep.number + ' · ' + minutesLabel(ep.duration) +
                (ep.airDate ? ' · ' + ep.airDate : '');

            body.appendChild(title);
            body.appendChild(sub);

            if (ratio > 0 && !done) {
                var bar = document.createElement('div');
                bar.className = 'ep-bar';
                var fill = document.createElement('span');
                fill.style.width = Math.round(ratio * 100) + '%';
                bar.appendChild(fill);
                body.appendChild(bar);
            }

            var status = document.createElement('span');
            status.className = 'ep-state' + (done ? ' done' : '');
            status.textContent = done ? '✓' : '▶';
            status.setAttribute('aria-hidden', 'true');

            item.appendChild(thumb);
            item.appendChild(body);
            item.appendChild(status);

            item.setAttribute('aria-label', 'Reproducir ' + ep.title);
            item.addEventListener('click', function () {
                playEpisode(state.anime, state.seasonIndex, index);
            });

            list.appendChild(item);
        });
    }

    function updateFavButtonState() {
        var btn = $('favBtn');
        if (!btn) return;
        if (!state.anime) {
            btn.textContent = '➕ Mi lista';
            btn.classList.remove('saved');
            return;
        }
        var saved = state.favorites.has(state.anime.id);
        btn.classList.toggle('saved', saved);
        btn.textContent = saved ? '✓ En mi lista' : '➕ Mi lista';
    }

    /* ===================================================================== */
    /* Reproductor                                                           */
    /* ===================================================================== */
    function playEpisode(anime, seasonIndex, episodeIndex) {
        var season = anime.seasons[seasonIndex];
        if (!season) return;
        var ep = season.episodes[episodeIndex];
        if (!ep) return;

        state.playerReturn = location.hash.indexOf('#/ver/') === 0
            ? state.playerReturn
            : (location.hash || '#/');

        go('#/ver/' + encodeURIComponent(anime.id) + '/' + season.number + '/' + ep.number);
    }

    function openPlayerRoute(animeId, seasonNumber, episodeNumber) {
        var anime = findAnime(animeId);
        if (!anime) { go('#/'); return; }

        var sIdx = 0;
        for (var i = 0; i < anime.seasons.length; i++) {
            if (String(anime.seasons[i].number) === String(seasonNumber)) { sIdx = i; break; }
        }

        var season = anime.seasons[sIdx];
        var eIdx = 0;
        for (var j = 0; j < season.episodes.length; j++) {
            if (String(season.episodes[j].number) === String(episodeNumber)) { eIdx = j; break; }
        }

        renderDetail(anime, sIdx);
        $('detailScreen').classList.add('active');
        $('detailScreen').setAttribute('aria-hidden', 'false');

        showPlayerUI();
        startEpisode(anime, sIdx, eIdx, true);
    }

    function startEpisode(anime, seasonIndex, episodeIndex, autoplay) {
        var season = anime.seasons[seasonIndex];
        var ep = season.episodes[episodeIndex];
        if (!ep) return;

        var key = anime.id + '|' + ep.id;
        var isSame = state.episodeKey === key;

        clearAutoNext();

        state.anime = anime;
        state.seasonIndex = seasonIndex;

        if (!isSame) {
            state.episode = {
                animeId: anime.id,
                animeTitle: anime.title,
                animeImage: anime.banner || anime.poster,
                seasonId: season.id,
                seasonNumber: season.number,
                episodeId: ep.id,
                episodeNumber: ep.number,
                title: ep.title,
                type: (ep.sources && ep.sources[0] && ep.sources[0].type) || 'mp4'
            };
            state.episodeKey = key;
            state.resumeApplied = false;
            state.lastSaveAt = 0;

            loadSource(ep, anime);
            updatePlayerMeta(anime, season, ep);
            document.title = ep.title + ' · ' + anime.title + ' · Snowball';
            renderSeasons();
            renderEpisodes();
        }

        if (autoplay) playMedia();
        syncChrome();
    }

    function updatePlayerMeta(anime, season, ep) {
        $('fullPlayer').style.setProperty('--art', 'url("' + String(anime.banner || anime.poster).replace(/"/g, '%22') + '")');
        $('videoTitle').textContent = ep.title;
        $('videoSubtitle').textContent = anime.title + ' · T' + season.number + ' E' + ep.number;

        $('miniTitle').textContent = ep.title;
        $('miniSubtitle').textContent = anime.title + ' · T' + season.number + ' E' + ep.number;
        setBg($('miniArt'), anime.poster || anime.banner);

        $('timeCurrent').textContent = '0:00';
        $('timeTotal').textContent = formatTime(ep.duration);
        $('seekBar').value = '0';
    }

    function loadSource(ep, anime) {
        detachHls();

        // Se ignoran fuentes vacías para no romper el episodio por un mirror mal escrito
        var sources = (ep.sources || []).filter(function (s) { return s && s.url; });
        var src = sources[0];
        var badge = $('playerBadge');
        var embed = $('embedFrame');

        embed.hidden = true;
        embed.removeAttribute('src');
        video.hidden = false;
        badge.hidden = true;

        if (!src) {
            setMediaControls(false);
            toast('Este episodio todavía no tiene vídeo disponible.', 'err', 4500);
            return;
        }

        if (src.type === 'embed') {
            setMediaControls(false);
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.hidden = true;
            embed.hidden = false;
            // Algunos reproductores externos bloquean el iframe si reciben Referer
            embed.setAttribute('referrerpolicy', src.referrerPolicy || 'strict-origin-when-cross-origin');
            if (src.allow) embed.setAttribute('allow', src.allow);
            embed.src = src.url;
            badge.hidden = false;
            badge.textContent = 'Externo';
            return;
        }

        setMediaControls(true);
        video.hidden = false;
        video.poster = ep.thumb || anime.banner || anime.poster || '';

        var isHls = src.type === 'hls' || /\.m3u8(\?|$)/i.test(src.url);

        if (isHls) {
            badge.hidden = false;
            badge.textContent = 'HLS';

            if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = src.url;
                video.load();
                return;
            }

            if (window.Hls && window.Hls.isSupported()) {
                state.hls = new window.Hls({ maxBufferLength: 30 });
                state.hls.loadSource(src.url);
                state.hls.attachMedia(video);
                state.hls.on(window.Hls.Events.ERROR, function (_event, data) {
                    if (data && data.fatal) toast('Error de streaming (HLS): ' + data.type, 'err', 5000);
                });
                return;
            }

            toast('Tu navegador no puede reproducir este formato HLS.', 'err', 5000);
            return;
        }

        video.src = src.url;
        video.load();
    }

    function detachHls() {
        if (state.hls) {
            try { state.hls.destroy(); } catch (err) { /* noop */ }
            state.hls = null;
        }
    }

    function setMediaControls(enabled) {
        // "Detener" sigue disponible en modos externos (embed) para cerrar.
        ['seekBar', 'restartBtn', 'playPauseBtn'].forEach(function (id) {
            var el = $(id);
            if (el) el.disabled = !enabled;
        });
        var stop = $('stopBtn');
        if (stop) stop.disabled = false;

        if (!enabled) {
            $('timeCurrent').textContent = '—';
            $('timeTotal').textContent = '—';
        }
    }

    function playMedia() {
        if (!state.episode || state.episode.type === 'embed') return;
        var promise = video.play();
        if (promise && typeof promise.catch === 'function') {
            promise.catch(function () {
                toast('Pulsa ▶ para iniciar la reproducción (el navegador bloqueó el autoplay).');
            });
        }
    }

    function maybeResume() {
        if (!state.episode || state.resumeApplied) return;

        var rec = progressOf(state.episode.episodeId);
        if (!rec) return;

        var position = Number(rec.position) || 0;
        var duration = isFinite(video.duration) ? video.duration : 0;

        if (position < (CFG.resumeFromSeconds || 10)) return;
        if (duration && position > duration - 15) return;

        video.currentTime = position;
        state.resumeApplied = true;
        toast('Continuando desde ' + formatTime(position));
    }

    function clearAutoNext() {
        if (state.autoNextTimer) {
            clearTimeout(state.autoNextTimer);
            state.autoNextTimer = null;
        }
    }

    function updateProgressUI() {
        var duration = video.duration;
        var pct = (duration && isFinite(duration)) ? (video.currentTime / duration) * 100 : 0;

        $('miniProgress').style.width = pct + '%';

        var seek = $('seekBar');
        if (seek && !seek.dataset.dragging) seek.value = String(pct);

        $('timeCurrent').textContent = formatTime(video.currentTime);
        $('timeTotal').textContent = formatTime(isFinite(duration) ? duration : 0);
    }

    function updatePlayState() {
        var glyph = video.paused ? '▶' : '⏸';
        var main = $('playPauseBtn');
        var mini = $('miniToggleBtn');
        if (main) {
            main.textContent = glyph;
            main.setAttribute('aria-label', video.paused ? 'Reproducir' : 'Pausar');
        }
        if (mini) mini.textContent = glyph;
    }

    function togglePlayVideo() {
        if (!state.episode || state.episode.type === 'embed') return;
        if (video.paused) playMedia();
        else video.pause();
    }

    function restartVideo() {
        if (!state.episode) return;
        video.currentTime = 0;
        if (video.paused) playMedia();
    }

    function stopVideo() {
        saveProgress();
        closePlayer(true);
    }

    function showPlayerUI() {
        var player = $('fullPlayer');
        player.classList.add('active');
        player.setAttribute('aria-hidden', 'false');
        syncChrome();
    }

    function hidePlayerUI() {
        var player = $('fullPlayer');
        player.classList.remove('active');
        player.setAttribute('aria-hidden', 'true');
        syncChrome();
    }

    function syncChrome() {
        var playerOpen = $('fullPlayer').classList.contains('active');
        var showMini = !!state.episode && !playerOpen;

        $('miniPlayer').classList.toggle('visible', showMini);
        $('phoneContainer').classList.toggle('has-mini', showMini);
    }

    function minimizePlayer() {
        saveProgress();
        go(state.playerReturn || '#/');
    }

    function closePlayer(stop) {
        if (stop) stopPlayback();
        go(state.playerReturn || '#/');
    }

    function openPlayerFromMini() {
        if (!state.episode) return;
        go('#/ver/' + encodeURIComponent(state.episode.animeId) + '/' +
            state.episode.seasonNumber + '/' + state.episode.episodeNumber);
    }

    function stopPlayback() {
        clearAutoNext();
        detachHls();

        try {
            video.pause();
            video.removeAttribute('src');
            video.load();
        } catch (err) { /* noop */ }

        var embed = $('embedFrame');
        embed.hidden = true;
        embed.removeAttribute('src');

        state.episode = null;
        state.episodeKey = null;
        state.resumeApplied = false;

        syncChrome();
        updateProgressUI();
    }

    /* ===================================================================== */
    /* Comentarios                                                           */
    /* ===================================================================== */
    function renderCommentsSkeleton() {
        var list = $('commentList');
        list.innerHTML = '';
        for (var i = 0; i < 3; i++) {
            var sk = document.createElement('div');
            sk.className = 'skeleton';
            list.appendChild(sk);
        }
    }

    function commentHint(html) {
        var list = $('commentList');
        list.innerHTML = '<p class="hint">' + html + '</p>';
    }

    async function loadComments(animeId) {
        if (!animeId) return;

        state.commentsFor = animeId;
        var list = $('commentList');
        if (!list) return;

        if (!db) {
            commentHint('Los comentarios necesitan conexión con Supabase.');
            return;
        }

        renderCommentsSkeleton();

        var res = await db.from('comments')
            .select('id, user_id, content, created_at')
            .eq('anime_id', animeId)
            .order('created_at', { ascending: false })
            .limit(CFG.commentsLimit || 100);

        // Compatibilidad con una tabla comments sin columna anime_id
        if (res.error && isMissingTableOrColumn(res.error)) {
            res = await db.from('comments')
                .select('id, user_id, content, created_at')
                .order('created_at', { ascending: false })
                .limit(CFG.commentsLimit || 100);
        }

        if (res.error) {
            console.warn('[comentarios]', res.error.message);
            $('commentsCount').textContent = '0';
            commentHint('No se pudieron cargar los comentarios.' +
                '<br><button class="link-btn" type="button" id="retryComments">Reintentar</button>');
            var retry = $('retryComments');
            if (retry) retry.addEventListener('click', function () { loadComments(animeId); });
            return;
        }

        var comments = res.data || [];
        var activeId = state.user ? state.user.id : null;

        // Nombres y fotos en una segunda consulta: no depende de que exista
        // una relación (FK) entre comments y profiles para el embedding.
        var profiles = Object.create(null);
        var userIds = [];
        comments.forEach(function (comm) {
            if (comm.user_id && userIds.indexOf(comm.user_id) === -1) userIds.push(comm.user_id);
        });

        if (userIds.length) {
            var profRes = await db.from('profiles').select('id, username, avatar_url').in('id', userIds);

            // Instalaciones sin la migración de avatares: sin foto, pero sin romper
            if (profRes.error && isMissingTableOrColumn(profRes.error)) {
                profRes = await db.from('profiles').select('id, username').in('id', userIds);
            }

            if (profRes.error) {
                console.warn('[perfiles de comentarios]', profRes.error.message);
            } else {
                (profRes.data || []).forEach(function (p) {
                    profiles[p.id] = { username: p.username, avatar_url: p.avatar_url || '' };
                });
            }
        }

        // Evita pintar comentarios de un anime que ya no está abierto
        if (state.commentsFor !== animeId) return;

        $('commentsCount').textContent = String(comments.length);
        list.innerHTML = '';

        if (!comments.length) {
            commentHint('Aún no hay comentarios. ¡Sé el primero!');
            return;
        }

        comments.forEach(function (comm) {
            var profile = profiles[comm.user_id] || {};
            var username = profile.username || 'Anónimo';
            var isOwner = activeId && activeId === comm.user_id;
            var avatarUrl = profile.avatar_url ||
                (isOwner ? (state.avatarUrl || avatarUrlFromUser(state.user)) : '');

            var item = document.createElement('div');
            item.className = 'comment-item';

            var avatar = document.createElement('div');
            avatar.className = 'comment-avatar';
            if (avatarUrl) {
                avatar.className += ' has-photo';
                var photo = document.createElement('img');
                photo.src = avatarUrl;
                photo.alt = '';
                photo.loading = 'lazy';
                photo.referrerPolicy = 'no-referrer';
                photo.addEventListener('error', function () {
                    avatar.classList.remove('has-photo');
                    avatar.textContent = initialsOf(username);
                });
                avatar.appendChild(photo);
            } else {
                avatar.textContent = initialsOf(username);
            }

            var body = document.createElement('div');
            body.className = 'comment-body';

            var head = document.createElement('div');
            head.className = 'comment-head';

            var user = document.createElement('span');
            user.className = 'comment-user';
            user.textContent = '@' + username;

            var date = document.createElement('span');
            date.className = 'comment-date';
            date.textContent = timeAgo(comm.created_at);

            head.appendChild(user);
            head.appendChild(date);

            if (isOwner) {
                var del = document.createElement('button');
                del.type = 'button';
                del.className = 'comment-del';
                del.textContent = 'Eliminar';
                del.addEventListener('click', function () { deleteComment(comm.id, del); });
                head.appendChild(del);
            }

            var text = document.createElement('p');
            text.className = 'comment-text';
            text.textContent = comm.content;

            body.appendChild(head);
            body.appendChild(text);

            item.appendChild(avatar);
            item.appendChild(body);
            list.appendChild(item);
        });
    }

    async function postComment() {
        if (!state.anime) return;

        var input = $('commentInput');
        var btn = $('commentSubmitBtn');
        var content = input.value.trim();

        if (!state.user) {
            toast('Inicia sesión para poder comentar');
            openLoginModal();
            return;
        }
        if (!content) {
            toast('El comentario no puede estar vacío');
            input.focus();
            return;
        }
        if (!db) {
            toast('Los comentarios necesitan conexión con Supabase.', 'err');
            return;
        }

        btn.disabled = true;

        var res = await db.from('comments').insert({
            user_id: state.user.id,
            anime_id: state.anime.id,
            content: content
        });

        btn.disabled = false;

        if (res.error) {
            toast('No se pudo publicar: ' + res.error.message, 'err', 5500);
            return;
        }

        input.value = '';
        toast('Comentario publicado', 'ok');
        loadComments(state.anime.id);
    }

    async function deleteComment(commentId, btn) {
        if (!db) return;
        if (btn) { btn.disabled = true; btn.textContent = '...'; }

        var res = await db.from('comments').delete().eq('id', commentId);

        if (res.error) {
            toast('No se pudo eliminar: ' + res.error.message, 'err', 5000);
            if (btn) { btn.disabled = false; btn.textContent = 'Eliminar'; }
            return;
        }

        toast('Comentario eliminado', 'ok');
        loadComments(state.commentsFor);
    }

    /* ===================================================================== */
    /* Eventos globales                                                      */
    /* ===================================================================== */
    function bindEvents() {
        var searchInput = $('searchInput');
        var searchTimer = null;
        searchInput.addEventListener('input', function () {
            state.query = searchInput.value;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(renderCatalog, 120);
        });

        $('commentInput').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); postComment(); }
        });

        var seek = $('seekBar');
        seek.addEventListener('input', function () {
            seek.dataset.dragging = '1';
            if (isFinite(video.duration) && video.duration > 0) {
                $('timeCurrent').textContent = formatTime((seek.value / 100) * video.duration);
            }
        });
        seek.addEventListener('change', function () {
            if (isFinite(video.duration) && video.duration > 0) {
                video.currentTime = (seek.value / 100) * video.duration;
            }
            delete seek.dataset.dragging;
        });

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if ($('fullPlayer').classList.contains('active')) { minimizePlayer(); return; }
            if ($('profileModal').classList.contains('active')) { closeProfileModal(); return; }
            if ($('loginModal').classList.contains('active')) { closeLoginModal(); return; }
            if ($('detailScreen').classList.contains('active')) closeDetail();
        });

        $('miniPlayer').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayerFromMini(); }
        });

        video.addEventListener('loadedmetadata', function () {
            maybeResume();
            updateProgressUI();
        });

        video.addEventListener('timeupdate', function () {
            updateProgressUI();

            var now = Date.now();
            if (now - state.lastSaveAt > (CFG.progressSaveEveryMs || 5000)) {
                state.lastSaveAt = now;
                saveProgress();
            }
        });

        video.addEventListener('durationchange', updateProgressUI);
        video.addEventListener('play', updatePlayState);
        video.addEventListener('pause', function () {
            updatePlayState();
            saveProgress();
        });

        video.addEventListener('ended', function () {
            saveProgress();
            updatePlayState();

            if (!state.episode) return;

            // Si el reproductor está minimizado, state.anime puede ser null:
            // se recupera desde el episodio en curso.
            var currentAnime = state.anime || findAnime(state.episode.animeId);
            if (!currentAnime) return;

            var next = nextEpisode(currentAnime, state.episode.seasonId, state.episode.episodeId);

            if (!next) {
                toast('Has terminado esta temporada 🎉', 'ok', 4000);
                return;
            }

            var delay = Math.max(1500, CFG.autoNextDelayMs || 4000);
            toast('Siguiente episodio en ' + Math.round(delay / 1000) + ' s');
            clearAutoNext();
            state.autoNextTimer = setTimeout(function () {
                state.autoNextTimer = null;
                playEpisode(currentAnime, next.seasonIndex, next.episodeIndex);
            }, delay);
        });

        video.addEventListener('error', function () {
            if (state.episode && state.episode.type !== 'embed') {
                toast('No se pudo cargar el vídeo. Revisa tu conexión.', 'err', 4500);
            }
        });

        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                if (!video.paused) video.pause();
                saveProgress();
            }
        });

        window.addEventListener('pagehide', saveProgress);

        window.addEventListener('hashchange', handleRoute);
    }

    /* ===================================================================== */
    /* Arranque                                                              */
    /* ===================================================================== */
    function init() {
        // Copia guardada de la última descarga: arranque instantáneo y offline
        var cached = readCatalogCache();
        if (cached) replaceCatalog(cached);

        if (!CATALOG.length) {
            toast('No se pudo cargar el catálogo (js/data/catalog.js)', 'err', 8000);
            return;
        }

        renderHome();
        renderChips();
        renderCatalog();
        renderFavorites();
        renderHeaderUser();
        renderContinueShelf();

        loadFavorites();
        loadProgress();
        initAuth();

        bindEvents();

        if (!location.hash) history.replaceState(null, '', '#/');
        handleRoute();

        // Se pide la versión nueva en segundo plano (no bloquea el arranque)
        syncCatalog();

        // Al volver a la app (móvil/APK) se comprueba si hay cambios
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) return;
            if (Date.now() - catalogSync.lastAt >= (CFG.catalogRefreshMs || 300000)) syncCatalog();
        });
    }

    /* Funciones usadas por los onclick del HTML */
    window.switchTab = switchTab;
    window.goExplore = goExplore;
    window.closeDetail = closeDetail;
    window.toggleFavorite = function () {
        if (state.anime) toggleFavorite(state.anime.id);
    };
    window.postComment = postComment;
    window.loginWithGoogle = loginWithGoogle;
    window.openLoginModal = openLoginModal;
    window.closeLoginModal = closeLoginModal;
    window.openProfileModal = openProfileModal;
    window.closeProfileModal = closeProfileModal;
    window.saveProfileChanges = saveProfileChanges;
    window.logoutUser = logoutUser;
    window.openPlayerFromMini = openPlayerFromMini;
    window.minimizePlayer = minimizePlayer;
    window.closePlayer = closePlayer;
    window.togglePlayVideo = togglePlayVideo;
    window.restartVideo = restartVideo;
    window.stopVideo = stopVideo;
    window.refreshCatalog = function () { return syncCatalog({ announce: true }); };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
