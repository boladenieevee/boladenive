/* =========================================================================
   PLANTILLA · añadir un anime a Snowball
   -------------------------------------------------------------------------
   Este archivo NO está enlazado desde index.html: es solo una referencia.

   Pasos:
     1. Abre js/data/catalog.js
     2. Copia el objeto de abajo (desde la llave { hasta la llave })
     3. Pégalo antes del `];` final del array CATALOG
     4. Guarda y recarga la app con Ctrl + F5

   Consejos rápidos:
     • `id` único, en minúsculas y con guiones: 'frieren', 'one-piece'.
     • Los ids de temporada y episodio los genera makeSeason() solo.
     • Usa la URL de EMBED del reproductor, no la de la página del capítulo.
     • Si el iframe sale vacío, ese host bloquea iframes: prueba otro mirror.
     • Solo se usa la PRIMERA fuente de `sources`.
   ========================================================================= */

{
    id: 'frieren',
    title: 'Frieren: Beyond Journey\'s End',
    originalTitle: 'Sousou no Frieren',
    year: 2023,
    genres: ['Fantasía', 'Aventura', 'Drama'],
    studio: 'Madhouse',
    status: 'Finalizada',
    rating: 9.0,
    ageRating: '13+',
    synopsis: 'Tras derrotar al Rey Demonio, la maga elfa Frieren sobrevive a sus compañeros y emprende un viaje para entender el tiempo y los vínculos humanos.',
    poster: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=440&q=70',
    banner: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1200&q=70',
    featured: false,
    trending: true,
    seasons: [
        makeSeason('frieren', 1, 2023, [
            {
                // Episodio con reproductor externo (embed)
                title: 'El final del viaje',
                duration: 1560, // segundos (26 min)
                thumb: null,    // opcional: 'https://.../thumb.jpg'
                sources: [
                    {
                        type: 'embed',
                        url: 'https://player-ejemplo.com/e/frieren-1x01',
                        // Algunos hosts bloquean el iframe si reciben Referer:
                        referrerPolicy: 'no-referrer'
                    }
                ]
            },
            {
                // Episodio con vídeo propio (mp4 o HLS)
                title: 'No hace falta ser mago',
                sources: [
                    { type: 'mp4', url: 'https://cdn.midominio.com/frieren/1x02.mp4' }
                    // { type: 'hls', url: 'https://cdn.midominio.com/frieren/1x02/master.m3u8' }
                ]
            },
            // Un string = episodio normal con el vídeo de demostración
            'La magia de los asesinos de flores'
        ], { title: 'Temporada 1' }),

        makeSeason('frieren', 2, 2024, [
            'Un nuevo viaje',
            'La ciudad de los magos'
        ], { title: 'Temporada 2' })
    ]
}
