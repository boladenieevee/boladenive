/* =========================================================================
   Snowball · configuración
   -------------------------------------------------------------------------
   La anon key de Supabase es pública por diseño: la seguridad real la dan
   las políticas RLS del archivo sql/schema.sql. No pongas aquí la service_role.
   ========================================================================= */

window.SNOWBALL_CONFIG = {
    appName: 'Snowball',

    supabaseUrl: 'https://reuoyqminebhttbomzxs.supabase.co',
    supabaseKey: 'sb_publishable_VTEyWClM1To5fKhc0KV4ww_DYMV_5E_',

    // Comentarios que se piden por anime
    commentsLimit: 100,

    // Catálogo remoto -------------------------------------------------------
    // URL del JSON con los animes. Se puede dejar relativa ('catalog.json',
    // subida junto a la web) o absoluta ('https://cdn.../catalog.json').
    // Déjalo vacío ('') para usar solo el catálogo incluido en la app.
    // En un APK, usa SIEMPRE una URL absoluta https:// para que las
    // actualizaciones lleguen sin recompilar.
    catalogUrl: 'catalog.json',
    catalogTimeoutMs: 8000,           // si tarda más, se usa la copia guardada
    catalogCacheKey: 'snowball.catalog.v1',
    catalogRefreshMs: 5 * 60 * 1000,  // revisa cambios al volver a la app

    // Reproducción
    progressMinSeconds: 5,      // no guardar progreso antes de 5 s
    progressSaveEveryMs: 5000,  // cada cuánto se sincroniza mientras se ve
    resumeFromSeconds: 10,      // mínimo para ofrecer "continuar donde lo dejaste"
    autoNextDelayMs: 4000       // cuenta atrás para el siguiente episodio
};
