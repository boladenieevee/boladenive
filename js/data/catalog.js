/* =========================================================================
   Snowball · catálogo
   -------------------------------------------------------------------------
   Datos de DEMOSTRACIÓN. Los títulos, temporadas y episodios son reales,
   pero los vídeos apuntan a archivos de prueba públicos (Google / Mux).
   Sustituye `sources` por tus URLs reales cuando tengas los derechos.

   Formato:
   {
     id, title, originalTitle, year, genres[], studio, status, rating,
     ageRating, synopsis, poster, banner, featured, trending,
     seasons: [{ id, number, title, year, episodes: [
        {
          id, number, title, duration (segundos), thumb,
          sources: [{ type, url, referrerPolicy? }]
        }
     ]}]
   }

   Tipos de fuente admitidos por el reproductor:
     { type: 'mp4',   url: 'https://.../video.mp4' }
     { type: 'hls',   url: 'https://.../master.m3u8' }
     { type: 'embed', url: 'https://www.youtube.com/embed/XXXX' }

   Para `embed` puedes añadir `referrerPolicy: 'no-referrer'` si el
   reproductor externo bloquea el iframe por el Referer.

   ATAJO PARA ESCRIBIR EPISODIOS:
   makeSeason() acepta títulos sueltos o fichas completas:

     makeSeason('mi-anime', 1, 2024, [
       'Episodio 1',                                    // demo automático
       { title: 'Episodio 2', sources: [                // fuente propia
           { type: 'embed', url: 'https://player.../e/abc' }
       ]}
     ])
   ========================================================================= */

(function () {
    'use strict';

    var VIDEOS = {
        bunny:   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        dream:   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
        blazes:  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        escapes: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
        hls:     'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
    };

    var CYCLE = ['bunny', 'dream', 'blazes', 'escapes'];
    var cursor = 0;

    function pad(n) { return n < 10 ? '0' + n : String(n); }

    function poster(id) { return 'https://images.unsplash.com/' + id + '?auto=format&fit=crop&w=440&q=70'; }
    function banner(id) { return 'https://images.unsplash.com/' + id + '?auto=format&fit=crop&w=1200&q=70'; }

    function makeEpisode(animeId, seasonNumber, number, title, minutes, sources) {
        var key = CYCLE[cursor++ % CYCLE.length];
        return {
            id: animeId + '-s' + seasonNumber + 'e' + pad(number),
            number: number,
            title: title,
            duration: Math.round(minutes * 60),
            thumb: null,
            sources: sources || [{ type: 'mp4', url: VIDEOS[key] }]
        };
    }

    function makeSeason(animeId, number, year, items, options) {
        var opts = options || {};
        return {
            id: animeId + '-s' + number,
            number: number,
            title: opts.title || ('Temporada ' + number),
            year: year,
            episodes: items.map(function (item, index) {
                // Cada posición puede ser un título ('Capítulo 1') o una ficha
                // completa ({ title, sources, minutes, duration, thumb })
                var data = typeof item === 'string' ? { title: item } : (item || {});
                var ep = makeEpisode(
                    animeId,
                    number,
                    index + 1,
                    data.title || ('Episodio ' + (index + 1)),
                    data.minutes || opts.minutes || 24,
                    data.sources
                );
                if (data.duration) ep.duration = data.duration;
                if (data.thumb) ep.thumb = data.thumb;
                return ep;
            })
        };
    }

    var CATALOG = [
        /* ---------------------------------------------------------------- */
        {
            id: 'demon-slayer',
            title: 'Demon Slayer',
            originalTitle: 'Kimetsu no Yaiba',
            year: 2019,
            genres: ['Acción', 'Fantasía', 'Shonen'],
            studio: 'ufotable',
            status: 'En emisión',
            rating: 8.7,
            ageRating: '16+',
            synopsis: 'Tanjiro Kamado ve destruida a su familia por un demonio y su hermana Nezuko es transformada. Para devolverle su humanidad, se une al Cuerpo de Exterminio de Demonios.',
            poster: poster('photo-1578632767115-351597cf2477'),
            banner: banner('photo-1578632767115-351597cf2477'),
            featured: true,
            trending: true,
            seasons: [
                makeSeason('demon-slayer', 1, 2019, [
                    'Crueldad',
                    'Sakonji Urokodaki, el entrenador',
                    'Sabito y Makomo',
                    'Selección final',
                    'Mi propio acero'
                ]),
                makeSeason('demon-slayer', 2, 2021, [
                    'El pilar del sonido',
                    'Infiltración en el distrito',
                    'Rostros tras el maquillaje',
                    'Cuando el sonido se apaga'
                ], { title: 'Temporada 2 · Distrito del Entretenimiento' })
            ]
        },

        /* ---------------------------------------------------------------- */
        {
            id: 'jujutsu-kaisen',
            title: 'Jujutsu Kaisen',
            originalTitle: 'Jujutsu Kaisen',
            year: 2020,
            genres: ['Sobrenatural', 'Acción', 'Shonen'],
            studio: 'MAPPA',
            status: 'Finalizada',
            rating: 8.6,
            ageRating: '16+',
            synopsis: 'Yuji Itadori ingiere un dedo maldito y pasa a compartir cuerpo con Sukuna, el rey de las maldiciones. Para sobrevivir se une a la Escuela Técnica de Jujutsu de Tokio.',
            poster: poster('photo-1607604276583-eef5d076aa5f'),
            banner: banner('photo-1607604276583-eef5d076aa5f'),
            trending: true,
            seasons: [
                makeSeason('jujutsu-kaisen', 1, 2020, [
                    'Ryomen Sukuna',
                    'Por mí mismo',
                    'La chica de acero',
                    'La matriz maldita debe morir',
                    'La matriz maldita debe morir II'
                ]),
                makeSeason('jujutsu-kaisen', 2, 2023, [
                    'Inventario oculto',
                    'Inventario oculto II',
                    'El incidente de Shibuya',
                    'Reencuentro'
                ], { title: 'Temporada 2 · Shibuya' })
            ]
        },

        /* ---------------------------------------------------------------- */
        {
            id: 'attack-on-titan',
            title: 'Attack on Titan',
            originalTitle: 'Shingeki no Kyojin',
            year: 2013,
            genres: ['Acción', 'Drama', 'Misterio'],
            studio: 'WIT Studio',
            status: 'Finalizada',
            rating: 9.1,
            ageRating: '18+',
            synopsis: 'La humanidad sobrevive refugiada tras enormes murallas. Cuando un titán rompe la muralla de Shiganshina, Eren jura exterminarlos a todos.',
            poster: poster('photo-1534447677768-be436bb09401'),
            banner: banner('photo-1534447677768-be436bb09401'),
            seasons: [
                makeSeason('attack-on-titan', 1, 2013, [
                    'A ti, en 2000 años',
                    'Ese día',
                    'La luz tenue de la desesperación',
                    'La noche de la graduación',
                    'Primera batalla'
                ]),
                makeSeason('attack-on-titan', 2, 2017, [
                    'Bestia',
                    'He vuelto',
                    'Hacia el suroeste'
                ])
            ]
        },

        /* ---------------------------------------------------------------- */
        {
            id: 'cyberpunk-edgerunners',
            title: 'Cyberpunk: Edgerunners',
            originalTitle: 'Cyberpunk: Edgerunners',
            year: 2022,
            genres: ['Sci-Fi', 'Acción', 'Drama'],
            studio: 'Studio Trigger',
            status: 'Finalizada',
            rating: 8.6,
            ageRating: '18+',
            synopsis: 'En Night City, un chico de la calle intenta sobrevivir en una sociedad obsesionada con la tecnología y la modificación corporal.',
            poster: poster('photo-1618336753974-aae8e04506aa'),
            banner: banner('photo-1618336753974-aae8e04506aa'),
            seasons: [
                makeSeason('cyberpunk-edgerunners', 1, 2022, [
                    'Let You Down',
                    'Like a Boy',
                    'Smooth Criminal',
                    'Lucky You',
                    'All Eyez on Me',
                    'Girl on Fire'
                ])
            ]
        },

        /* ---------------------------------------------------------------- */
        {
            id: 'one-piece',
            title: 'One Piece',
            originalTitle: 'One Piece',
            year: 1999,
            genres: ['Aventura', 'Shonen', 'Comedia'],
            studio: 'Toei Animation',
            status: 'En emisión',
            rating: 8.7,
            ageRating: '12+',
            synopsis: 'Monkey D. Luffy y su tripulación navegan por el Grand Line en busca del tesoro de Gol D. Roger para convertirle en el Rey de los Piratas.',
            poster: poster('photo-1563089145-599997674d42'),
            banner: banner('photo-1563089145-599997674d42'),
            trending: true,
            seasons: [
                makeSeason('one-piece', 1, 1999, [
                    '¡Soy Luffy! El hombre que será el Rey de los Piratas',
                    '¡El gran espadachín! Roronoa Zoro, el cazador de piratas',
                    'Morgan contra Luffy',
                    'La dama ladrona Nami',
                    'Un extraño pequeño'
                ])
            ]
        },

        /* ---------------------------------------------------------------- */
        {
            id: 'naruto',
            title: 'Naruto',
            originalTitle: 'Naruto',
            year: 2002,
            genres: ['Acción', 'Aventura', 'Shonen'],
            studio: 'Pierrot',
            status: 'Finalizada',
            rating: 8.4,
            ageRating: '12+',
            synopsis: 'Naruto Uzumaki, un ninja hiperactivo con un demonio sellado en su interior, persigue el sueño de convertirse en Hokage y ser reconocido por su aldea.',
            poster: poster('photo-1541701494587-cb58502866ab'),
            banner: banner('photo-1541701494587-cb58502866ab'),
            seasons: [
                makeSeason('naruto', 1, 2002, [
                    '¡Aquí estoy! ¡Naruto Uzumaki!',
                    '¡Mi nombre es Konohamaru!',
                    '¡Sasuke y Sakura! ¿Amigos o enemigos?',
                    '¡Entrenamiento! ¡El truco de la campana!',
                    '¡Suspenso! ¡El séptimo equipo se dispersa!'
                ])
            ]
        }
    ];

    /* Un episodio en HLS para demostrar el soporte de streaming adaptativo */
    CATALOG[0].seasons[0].episodes[3].sources = [{ type: 'hls', url: VIDEOS.hls }];

    /* ---------------------------------------------------------------------
       Revisión automática del catálogo.
       No bloquea nada: si te falta un campo, un id está repetido o una URL
       está mal, lo verás como aviso amarillo en la consola del navegador
       (F12 → Console) en lugar de descubrirlo con la app abierta.
       --------------------------------------------------------------------- */
    function validateCatalog(list) {
        var problems = [];
        var animeIds = Object.create(null);

        list.forEach(function (anime, index) {
            var where = 'CATALOG[' + index + ']' + (anime && anime.id ? ' "' + anime.id + '"' : '');

            if (!anime || typeof anime !== 'object') {
                problems.push(where + ': no es un objeto');
                return;
            }

            ['id', 'title', 'synopsis', 'poster', 'banner'].forEach(function (field) {
                if (!anime[field]) problems.push(where + ': falta "' + field + '"');
            });

            if (!anime.id) return;
            if (animeIds[anime.id]) problems.push(where + ': id de anime repetido');
            animeIds[anime.id] = true;

            if (!Array.isArray(anime.seasons) || !anime.seasons.length) {
                problems.push(where + ': no tiene temporadas');
                return;
            }

            var episodeIds = Object.create(null);

            anime.seasons.forEach(function (season) {
                if (!season || !Array.isArray(season.episodes) || !season.episodes.length) {
                    problems.push(where + ': temporada ' + (season && season.number) + ' sin episodios');
                    return;
                }

                season.episodes.forEach(function (ep) {
                    if (!ep || !ep.id) {
                        problems.push(where + ': episodio sin id');
                        return;
                    }

                    if (episodeIds[ep.id]) problems.push(where + ': episodio repetido "' + ep.id + '"');
                    episodeIds[ep.id] = true;

                    if (!ep.title) problems.push(where + ': "' + ep.id + '" sin título');

                    if (!Array.isArray(ep.sources) || !ep.sources.length) {
                        problems.push(where + ': "' + ep.id + '" sin fuente de vídeo');
                        return;
                    }

                    ep.sources.forEach(function (src) {
                        if (!src || !src.url) {
                            problems.push(where + ': "' + ep.id + '" tiene una fuente sin url');
                            return;
                        }
                        if (['mp4', 'hls', 'embed'].indexOf(src.type) === -1) {
                            problems.push(where + ': "' + ep.id + '" usa un tipo de fuente desconocido ("' + src.type + '")');
                        }
                        if (!/^https?:\/\//i.test(src.url)) {
                            problems.push(where + ': "' + ep.id + '" tiene una url que no empieza por http(s)://');
                        }
                    });
                });
            });
        });

        if (problems.length) {
            console.warn('[catálogo] Revisa estos datos:\n- ' + problems.join('\n- '));
        }
    }

    validateCatalog(CATALOG);

    window.validateCatalog = validateCatalog;
    window.CATALOG = CATALOG;
})();
