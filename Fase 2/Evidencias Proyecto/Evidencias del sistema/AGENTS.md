# Instrucciones para trabajar en este repositorio

Lee primero CONTEXTO_PROYECTO.md y README.md. Este es exclusivamente el entorno local de pruebas de VCM Piloto 2026, separado del proyecto productivo.

- Trabaja dentro de esta carpeta. No edites el repositorio productivo como efecto colateral.
- Conserva los bloqueos de api/src/lib/localSafety.js y db.js: sólo 127.0.0.1:14333 y vcm_piloto_2026_local.
- Conserva Azurite como único almacenamiento permitido. No introduzcas URLs, claves, identidades administradas, exports ni respaldos productivos.
- Todos los fixtures nuevos deben ser ficticios y utilizar example.test para correos.
- No habilites despliegues ni sincronización automática con el repositorio de origen. Las actualizaciones se incorporan explícitamente y se revisan aquí.
- No versiones .env, api/local.settings.json, node_modules, dist, archivos subidos ni volúmenes.
- Frontend: src/pages → src/services → api/src/functions → api/src/repositories → api/src/lib/SQL.
- Respeta permisos de cada rol, visibilidad por sección y consolidación global de hitos. Usa la API local sin respaldos silenciosos de escrituras.
- Migra con npm --prefix api run db:migrate; nunca con scripts de producción.
- Ejecuta npm run local:verify tras cambios funcionales. Para cambios de persistencia o videos, verifica además el flujo con SQL/Azurite y la API iniciados.
- No borres volúmenes ni datos de pruebas existentes sin una solicitud explícita del usuario.
