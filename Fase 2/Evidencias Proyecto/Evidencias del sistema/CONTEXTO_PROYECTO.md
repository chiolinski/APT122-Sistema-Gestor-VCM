# Contexto para continuar VCM Piloto 2026 Local

## Origen y objetivo

Copia de trabajo creada el 30 de octubre de 2026 desde vcm2026_2, cuya referencia Git al preparar la copia era f57bc9b (cierre masivo manual de revisiones del socio para administración). Se tomó el código de trabajo presente, incluyendo cambios locales pertinentes; la referencia no pretende ser una etiqueta exacta del árbol completo. No se trasladaron historial Git, remotos ni cambios a la carpeta productiva.

El usuario quiere un nuevo repositorio para experimentar y evolucionar por separado. Este archivo y AGENTS.md permiten retomar el trabajo sin leer el chat original.

## Qué hemos construido

Sistema Gestor de Proyectos de Asignaturas para Vinculación con el Medio: conecta coordinación, docentes, estudiantes y socios formadores. Incluye autenticación con correo/contraseña, sesiones SQL y cookies HttpOnly; administración de usuarios y perfiles académicos; carga CSV con validación y prevención de duplicados; gestión de socios individual/masiva; propuestas por asignatura, sedes y secciones responsables; nóminas, equipos, estados de estudiantes; archivos; tres hitos por sección; seguimiento y exportación Excel; reportes, auditoría, calidad de datos y notificaciones.

También conserva revisión del socio formador por enlace, evaluaciones por equipo, entrega de videos por estudiantes mediante enlaces temporales, retroalimentación del Hito 2 en dos fases y cierre manual/masivo de revisiones cuando corresponda. Los enlaces públicos son capacidades temporales y sus permisos se validan en la API.

## Roles y reglas de negocio

- Administrador (`admin`): usuarios, carga académica, correcciones, seguimiento, reportes, control y operaciones administrativas auditadas.
- Coordinador CITT y Director de Carrera (`coordinator` con distinto cargo visible): propuestas, socios y seguimiento. Un coordinador vinculado a carga docente puede adquirir `canTeach` sin una segunda cuenta.
- Docente (`teacher`): sólo sus secciones responsables; no debe acceder a nóminas, equipos o avances ajenos.
- Estudiantes y socios: flujos específicos por enlace temporal, no cuentas equivalentes al administrador.

El progreso se registra por sección y se consolida a nivel de proyecto. Hito 1 organiza nóminas y equipos (máximo 20 por sección); Hito 2 se programa después del Hito 1 global y comprende entregas, revisión del socio y revisión docente de retroalimentación; Hito 3 cierra la sección. No se deben reducir estas reglas a un único estado global. Las reaperturas y modificaciones conservan auditoría.

## Arquitectura y mapa de código

- `src/App.jsx`: rutas y controles de interfaz por rol.
- `src/context/AppContext.jsx`: sesión, catálogos y datos operacionales compartidos.
- `src/pages/ProjectDetailPage.jsx`: operación docente del proyecto.
- `src/components/HitoTwoPanel.jsx`, `PartnerReviewManager.jsx`, `BulkPartnerReviewClosure.jsx`: Hito 2 y revisiones.
- `src/pages/StudentVideoDeliveryPage.jsx`, `PartnerReviewPage.jsx`: flujos temporales para estudiantes/socios.
- `src/pages/AcademicDataPage.jsx`, `AcademicManagementPage.jsx`: carga y correcciones académicas.
- `src/pages/CoordinationMonitoringPage.jsx`, `PilotReportsPage.jsx`, `ControlCenterPage.jsx`: supervisión.
- `src/services/`: transporte HTTP bajo `/api`.
- `api/src/functions/`: endpoints Azure Functions Node v4.
- `api/src/repositories/`: SQL y transacciones; no trasladar autorizaciones sólo al frontend.
- `api/src/lib/`: autenticación, reglas, validación, archivos, videos y aislamiento local.
- `api/src/shared/partnerVideoPaths.mjs`: nombres y validación de rutas de video, compartido con frontend.
- `database/migrations/`: 18 archivos heredados; existen DOS migraciones 005 con nombres distintos. Se ordenan por nombre completo y se registran individualmente en vcm.Migracion; no renombrarlas por suposición.
- `fixtures/`: cuentas y carga sintética; `api/scripts/seed-local.js` utiliza validación/importación y repositorios del sistema para construir el escenario.
- `api/test/` y `test/`: pruebas heredadas y verificaciones del aislamiento local.

Tecnologías: React 19, React Router 7, Vite 6, Azure Functions Node v4, mssql, SQL Server, SDK Blob y ExcelJS. Consultar package.json y lockfiles para versiones exactas. La API es CommonJS; el frontend es ES Modules.

Tablas principales: Usuario, SesionUsuario, Docente, DocenteSeccion, Sede, Escuela, Asignatura, PeriodoAcademico, Seccion, Alumno, Matricula, CargaAcademica, SocioFormador, Proyecto, ProyectoSede, ProyectoSeccion, Equipo, EquipoAlumno, HitoProyecto, HitoProyectoSeccion, AvanceProyectoSeccion, ArchivoProyecto y las tablas de revisiones/entregas/auditoría agregadas por migraciones posteriores.

## Qué cambia en esta copia

1. SQL sólo en 127.0.0.1:14333 y base vcm_piloto_2026_local; se valida la configuración ANTES de conectar y el nombre real DESPUÉS. Únicamente el instalador conecta a master local para crear esta base.
2. Archivos/videos sólo en Azurite local; sin Azure Identity ni credenciales cloud. Contenedores privados vcm-local-project-files y vcm-local-videos.
3. Videos con firma SAS de Azurite, HTTP permitido exclusivamente por tratarse de localhost. En producción la política HTTPS original era distinta. No transportar esta relajación a producción.
4. Vite redirige /api exclusivamente a 127.0.0.1:7076, escucha en loopback y añade CSP para impedir conexiones del navegador a servidores externos. Banner persistente y cookie vcm_local_session.
5. Se eliminan fallback de escritura y carga académica demo: si la API local falla, se informa el fallo.
6. Datos creados desde cero: 5 cuentas, 2 sedes/secciones, 1 asignatura, 12 estudiantes y 1 proyecto. No hay videos ni documentos reales. Los RUT generados son sólo fixtures.
7. La entrega inicial excluyó el historial Git de origen, workflows de Azure, configuraciones privadas, exports, respaldos y scripts manuales con personas reales.
8. Arranque mediante compose.yaml y scripts locales. No hace falta una suscripción Azure.

## Actualizaciones y portabilidad

Git se inicializó en esta carpeta con la rama `main` el 14 de noviembre de 2026. [APT122-Sistema-Gestor-VCM](https://github.com/chiolinski/APT122-Sistema-Gestor-VCM) es la referencia académica. Su raíz contiene las evidencias de las fases y la copia del código está en `Fase 2/Evidencias Proyecto/Evidencias del sistema/`.

En la revisión de `df35dd0`, los 189 archivos de esa subcarpeta tienen su equivalente local. Coinciden 175 archivos y difieren 14. La carpeta local agrega 21 archivos fuera de esa subcarpeta remota. Las diferencias funcionales incluyen la demostración DEMO26, el cálculo y filtrado de indicadores de seguimiento en la API, la comparación por sede en pantalla y Excel, y el manejo de GUID de videos devueltos por SQL en mayúsculas.

Usa esta carpeta como base de trabajo del entorno local. Para incorporar una actualización, revisa el diff de la subcarpeta de Fase 2 contra esta raíz. La referencia académica se consulta por separado y las incorporaciones son explícitas. Mantén `local.settings.json` y `.env` propios del entorno local.

La carpeta contiene código, configuración de ejemplo y fixtures; los datos creados al ejecutar viven en volúmenes Docker fuera del repositorio. En un equipo nuevo ejecuta las instrucciones de README.md para reconstruir el escenario ficticio. No existe una copia oculta de producción que deba recuperarse.

## Validación y límites

Consulta VERIFICACION.md para los resultados concretos al entregar. Las pruebas unitarias no equivalen a una prueba con SQL, Azurite y Functions levantados. La primera operación pendiente en un equipo preparado es ejecutar local:setup y probar el flujo manual descrito en README.md.

## Demostración ampliada · 5 de noviembre de 2026

El entorno ya fue preparado en este equipo: SQL, Azurite, API y web funcionan en sus puertos locales; las 18 migraciones se aplicaron. Las herramientas de Functions instaladas localmente están en `.local/tools/node_modules/azure-functions-core-tools/bin/func.exe`.

El comando optativo `npm run local:demo` agrega un escenario DEMO26 mediante la API real: 250 cuentas internas adicionales (5 administradores, 20 coordinadores CITT, 25 directores y 200 docentes), 2.880 estudiantes, 40 socios y 80 proyectos en 16 escenarios. Diez coordinadores también tienen docencia. Cada proyecto tiene tres secciones; se incluyen entregas MP4 sintéticas, documentos, revisiones parciales/finales/vencidas/revocadas, cierres y reaperturas. Consultar `DEMOSTRACION_LOCAL.md` y la actualización de `VERIFICACION.md`.

La receta está en `api/scripts/lib/showcase-fixtures.js`; el ejecutor es `api/scripts/seed-showcase.js`. Los datos iniciales se conservaron. La carga se reanuda mediante `.local/showcase/state.json` y, una vez completada, una segunda ejecución no restablece los avances que haga el usuario. No borrar ese estado para reinicializar datos. La guía con cuentas, proyectos y enlaces temporales está en `.local/showcase/GUIA.md`; estos archivos y los medios generados están ignorados por Git.

La única simulación SQL especial modifica y audita fechas exclusivamente de las revisiones DEMO26 destinadas a ejemplificar vencimientos. Los hitos se alcanzan con los endpoints reales. Se corrigió y verificó el manejo de GUID SQL en mayúsculas para las rutas de video, conservando la validación de pertenencia a equipo y sección.

## Indicadores de seguimiento · 5 de noviembre de 2026

Seguimiento incorpora el panel de participación y avance en `src/components/MonitoringIndicators.jsx`. Sus cifras provienen de la API: `coordinationMonitoringRepository.js` consulta matrículas activas, equipos y revisiones; `api/src/lib/monitoringIndicators.js` calcula personas únicas, hitos globales, avance por sección y valoración. Se mantienen los permisos de administración/coordinación.

Los participantes son alumnos activos con matrícula vigente y equipo asignado. Los hitos globales requieren todas las secciones; la finalización exige también el estado finalizado del proyecto. Las respuestas del socio usan la revisión vigente por sección, o la revisión registrada en el cierre de Hito 2. Se incluyen respuestas parciales y vencidas; se excluyen revisiones revocadas que no hayan sido utilizadas en un cierre. La valoración es el promedio de los promedios por proyecto, con igual peso y sin incorporar proyectos sin evaluaciones. Los indicadores excluyen proyectos cancelados.

Los filtros superiores de sede, estado y búsqueda actualizan los indicadores, las alertas y el listado mediante una misma respuesta de la API. Las respuestas anteriores se descartan cuando cambia la selección. La sede selecciona proyectos vinculados a ella y conserva todas sus secciones para calcular los hitos globales. El apartado de alertas permite ocultar y mostrar su contenido, manteniendo esa elección al filtrar. La exportación agrega una hoja Indicadores y recalcula las cifras para la selección exportada. Se verificaron las cifras contra SQL y el Excel completo, filtrado y vacío; consultar VERIFICACION.md.

La comparación gráfica por sede está en `src/components/MonitoringCampusCharts.jsx`. La misma respuesta filtrada incorpora `campusComparisons`, calculado por `buildCampusComparisons` en `api/src/lib/monitoringIndicators.js`, sin consultas ni dependencias nuevas. Muestra participación de estudiantes únicos por sede y avance de los tres hitos de sus secciones. A diferencia del resumen global, esta comparación considera sólo las secciones de cada sede y, al seleccionar una sede, muestra únicamente esa sede. Una persona o proyecto puede figurar en más de una sede; las filas no son sumables. Sin matrícula, la participación se informa como no calculable. Incluye barras con escala común de 0 a 100%, valores accesibles y tabla desplegable.

La exportación incorpora la hoja «Comparación por sede», con los filtros aplicados, la tabla de `report.campusComparisons` y gráficos nativos editables. `api/src/lib/monitoringCampusWorkbook.js` crea la tabla y añade las partes OOXML después de la escritura de ExcelJS; no volver a guardar el resultado con ExcelJS, que descarta los gráficos. JSZip 3.10.1, ya usado por ExcelJS, se declara también como dependencia directa. Las series referencian las celdas de esa hoja y sus cachés se generan con las mismas cifras que la pantalla. Los porcentajes tienen fórmulas con resultados guardados y escala de 0 a 100%. Una selección vacía conserva filtros y aviso sin gráficos. Si no hay matrícula en ninguna sede, se omite sólo el gráfico de participación. «Vista filtrada» respeta sede, estado y búsqueda; «Portafolio completo» conserva su alcance global explícito.

## Integración de la rama metricas · 14 de noviembre de 2026

La rama académica `metricas` (`f66e54b`) aporta entregas de video, deserción, distribución por escuela y un desglose de indicadores por proyecto. Se integraron en `projects/monitoring` y su exportación. Seguimiento parte en «Todos los períodos». El período académico se combina con sede, estado y búsqueda. El resumen y el desglose por proyecto conservan todas las secciones de cada proyecto seleccionado. La comparación por sede toma las secciones de la sede y del período elegidos.

Videos y deserción consideran los proyectos en ejecución o finalizados. Para videos se cuentan equipos con estudiantes activos asignados y entregas confirmadas. La deserción usa la matrícula vigente por proyecto y cuenta una sola vez al estudiante en ese proyecto. La distribución por escuela incluye planificados y excluye cancelados. En el desglose, la respuesta mide revisiones vigentes completadas por el socio y la valoración requiere tres evaluaciones por proyecto. El resumen existente conserva su criterio de respuestas parciales y su valoración desde la primera evaluación válida. Excel incluye las hojas «Proyectos por escuela» e «Indicadores por proyecto», además de los gráficos nativos por sede. Los resultados de la prueba local están en `VERIFICACION.md`.
