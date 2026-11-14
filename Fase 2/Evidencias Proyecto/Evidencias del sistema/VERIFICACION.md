# Verificación de la entrega · 30 de octubre de 2026

La copia se verificó con Node.js v22.13.0 en Windows. No se modificaron los archivos de trabajo del proyecto de origen.

| Comprobación | Resultado |
| --- | --- |
| `npm run local:verify` | Correcto |
| Pruebas frontend | 45 aprobadas, 0 fallidas |
| Pruebas API | 228 aprobadas, 0 fallidas |
| Pruebas de aislamiento | 7 incluidas en la suite API, también ejecutadas por separado |
| ESLint | Sin errores ni advertencias |
| Compilación Vite | Correcta |
| Preview de la compilación | HTTP 200; título LOCAL, banner, bundle y cabecera CSP comprobados |
| Configuración local | Generación de contraseña SQL aleatoria e idempotencia comprobadas, sin imprimir credenciales |
| `docker compose config --quiet` | Correcto |
| Lockfiles frontend/API | `npm ci --dry-run --ignore-scripts --offline --no-audit` correcto |
| Infraestructura productiva en código, fixtures y migraciones | Sin referencias al servidor/base o cuenta de videos de origen |
| Git, despliegues, configuración privada y dependencias en la carpeta entregada | Excluidos; consultar MANIFIESTO_ENTREGA.json |

Son **273 pruebas distintas** entre frontend y API. Las siete de aislamiento forman parte de las 228 de API; su ejecución adicional no se cuenta dos veces.

Para ejecutar las pruebas se utilizaron copias temporales de las dependencias ya instaladas en el equipo. La entrega conserva los lockfiles para instalar las dependencias mediante `npm ci`; no incluye `node_modules` ni una compilación `dist`.

Los tests heredados específicos de los instaladores SSMS se adaptaron a las migraciones incluidas, porque esta copia excluye los scripts manuales de producción. Los tests de videos se ajustaron al destino y las firmas de Azurite; se agregaron pruebas de rechazo de conexiones externas. Se conservaron las pruebas de roles, acceso por sección, importaciones, Hito 2, evaluación, cierre y persistencia mediante sus dobles de prueba.

## Pendiente de comprobar con servicios iniciados

El motor de Docker Desktop no estaba iniciado y Azure Functions Core Tools no estaba disponible en PATH durante la preparación. Por ello **no se ejecutaron las migraciones ni la carga sintética contra un SQL Server activo**, ni se probó la carga/lectura efectiva de archivos o videos en Azurite, ni el inicio de sesión contra la API en funcionamiento.

Después de iniciar Docker Desktop e instalar Azure Functions Core Tools v4, sigue README.md: instala dependencias, ejecuta `local:configure`, `local:infra`, `local:setup`, y abre API/web en dos terminales. Completa entonces el recorrido manual de permisos, hitos, archivos y revisiones indicado en esa guía. El éxito de las pruebas unitarias y de compilación no sustituye ese recorrido.

## Actualización · 5 de noviembre de 2026

Se iniciaron Docker Desktop, SQL Server y Azurite; se preparó la base `vcm_piloto_2026_local` y se aplicaron las 18 migraciones mediante `npm --prefix api run db:migrate`. Azure Functions Core Tools v4 quedó instalado en `.local/tools/`. La API escucha en `127.0.0.1:7076` y Vite en `127.0.0.1:5176`.

Se ejecutó `npm run local:demo`, documentado en `DEMOSTRACION_LOCAL.md`. Agregó 250 cuentas, 2.880 estudiantes, 40 socios y 80 proyectos, distribuidos en 16 escenarios de hitos y revisiones. Los totales de la base son 255 cuentas, 2.892 estudiantes, 41 socios y 81 proyectos; además hay 645 equipos, 260 documentos, 465 videos MP4 sintéticos, 150 revisiones y 366 evaluaciones.

| Comprobación nueva | Resultado |
| --- | --- |
| `npm run local:verify` | Correcto: 45 pruebas frontend, 234 API, aislamiento adicional, lint y build |
| Pruebas distintas | 279; las siete de aislamiento están incluidas en las 234 de API |
| Registros previos | 78 registros comprobados mediante identificadores y hashes; conservados, excluyendo sesiones y campos volátiles de autenticación |
| Segunda ejecución de la carga | Sin duplicados ni restablecimientos; iguales conteos y hashes de todas las tablas de datos, sin nuevas auditorías |
| Hitos | Estados por sección y consolidación global de los 80 proyectos comprobados |
| Roles reales | Administración, coordinación con/sin docencia, dirección y docente comprobados contra la API |
| Acceso docente | Sólo su sección y doce estudiantes; sección ajena, gestión de usuarios y seguimiento rechazados |
| Archivos | Documento ficticio descargado mediante API; descarga sin sesión rechazada |
| Videos | Los 465 blobs confirmados existen en Azurite, con tipo y tamaño correctos; MP4 firmado leído mediante Range; acceso anónimo rechazado |
| Enlaces | Revisión parcial persistida; equipo ajeno, enlace vencido y enlace revocado rechazados |
| Supervisión | Seguimiento, reportes, calidad de datos, auditoría, notificaciones y exportación Excel responden correctamente |

La prueba real detectó y corrigió una diferencia de mayúsculas/minúsculas en los GUID devueltos por SQL para las rutas de video. Las nuevas rutas se emiten con GUID normalizados; las entregas anteriores conservan su nombre exacto, validando el equipo y la sección. Se agregó una prueba de regresión que comprueba ambas variantes y rechaza identificadores ajenos o malformados.

La verificación del escenario se realizó mediante API, SQL y Azurite iniciados. Los resultados del 30 de octubre se mantienen arriba como registro histórico. La guía de navegación y los enlaces temporales del escenario actual están en `.local/showcase/GUIA.md`, fuera del versionado.

## Indicadores de seguimiento · 5 de noviembre de 2026

`npm run local:verify` aprobó lint, compilación, 49 pruebas frontend y 240 API: 289 pruebas distintas. Las siete de aislamiento también se ejecutaron por separado.

Se agregaron pruebas de personas/equipos únicos entre proyectos, hitos parciales y reaperturas, exclusión de cancelados, promedio de proyectos con igual peso, revisiones parciales/vencidas/revocadas, portafolio vacío y selección filtrada. Las pruebas de interfaz verifican barras accesibles, ausencia de promedios inventados, alcance explícito de los filtros y conservación identificada de las últimas cifras ante un error de actualización.

Con SQL, Azurite y la API iniciados, las cifras del endpoint coincidieron con consultas SQL independientes:

| Indicador | Resultado |
| --- | ---: |
| Proyectos considerados | 81 |
| Estudiantes en nómina, sin duplicados | 2.892 |
| Estudiantes participantes con equipo | 2.150 |
| Participación estudiantil | 74,3 % |
| Docentes participantes | 212 |
| Equipos conformados | 645 |
| Socios vinculados | 41 |
| Proyectos con Hito 1 terminado | 70 |
| Proyectos con Hito 2 terminado | 15 |
| Proyectos finalizados | 5 |
| Avance de hitos por sección | 305 de 726: 42 % |
| Socios que respondieron / con revisión publicada | 40 / 40 |
| Revisiones con respuestas / consideradas | 120 / 135 |
| Evaluaciones consideradas | 321 |
| Proyectos valorados | 40 |
| Valoración promedio por proyecto | 4 de 5 |

El Excel completo incluyó 81 proyectos y 2.150 participantes. La exportación de finalizados recalculó cinco proyectos y 150 participantes; una selección sin resultados entregó ceros y «Sin evaluaciones». La hoja Indicadores incorpora las bases de cálculo. Las revisiones revocadas excluidas del cálculo explican la diferencia respecto de las 366 evaluaciones históricas del escenario.

La API respondió 200 para coordinación y dirección, y 403 para docentes. La pantalla se comprobó en el navegador con una cuenta ficticia; se revisaron cifras, barras de avance, valoración y distribución del panel. Captura local: `.local/logs/seguimiento-indicadores.jpg`.

## Filtros e interfaz de seguimiento · 5 de noviembre de 2026

Los filtros de sede, estado y búsqueda ahora se envían a la API y actualizan conjuntamente los indicadores, las alertas y los proyectos. Las sedes disponibles permanecen en el selector incluso cuando la selección no tiene resultados. Los proyectos conservan todas sus secciones para la consolidación global de hitos. El botón «Ocultar alertas» / «Mostrar alertas» conserva su elección durante los cambios de filtro.

`npm run local:verify` aprobó lint, compilación, 53 pruebas frontend y 243 API: 296 pruebas distintas. Las siete pruebas de aislamiento incluidas en API también se ejecutaron por separado. Se probaron filtros combinados, selección vacía, restauración de filtros, respuestas tardías descartadas, errores de actualización y conservación del estado del botón de alertas. Las pruebas de acceso comprueban autenticación y permisos antes de consultar el repositorio, y rechazan estados inválidos antes de conectar con SQL.

Con SQL, Azurite y la API iniciados, se verificaron estas selecciones y su correspondencia con la hoja Indicadores de cada Excel exportado:

| Selección | Proyectos | Estudiantes participantes | Alertas | Hito 1 / Hito 2 / Finalizados |
| --- | ---: | ---: | ---: | --- |
| Portafolio completo | 81 | 2.150 | 60 | 70 / 15 / 5 |
| Finalizados | 5 | 150 | 0 | 5 / 5 / 5 |
| Sede ficticia DEMO26 Aurora | 24 | 640 | 18 | 21 / 5 / 2 |
| Aurora y Finalizados | 2 | 60 | 0 | 2 / 2 / 2 |
| Finalizados y búsqueda sin coincidencias | 0 | 0 | 0 | 0 / 0 / 0 |

El endpoint rechazó un estado inválido con 400 y el acceso docente con 403. En el navegador se confirmó la selección Aurora y Finalizados, sus indicadores y el funcionamiento de ocultar/mostrar alertas, manteniendo el apartado contraído después de filtrar. Evidencias locales: `.local/logs/seguimiento-filtros.jpg`, `.local/logs/seguimiento-alertas.jpg`, `.local/logs/monitoring-filter-checks.json` y `.local/logs/verify-monitoring-filters.log`.

## Gráficos comparativos por sede · 5 de noviembre de 2026

Se agregaron gráficos de barras de participación estudiantil y avance de hitos por sección, con escala común de 0 a 100%, cifras explícitas y tabla desplegable. Sede, estado y búsqueda se aplican a los gráficos en la misma respuesta que alimenta indicadores, alertas y proyectos. La comparación usa sólo las secciones de cada sede y conserva la consolidación global de proyectos en el resumen existente.

`npm run local:verify` aprobó aislamiento, lint, compilación, 55 pruebas frontend y 245 API: 300 pruebas distintas. Las pruebas nuevas cubren estudiantes únicos por sede entre proyectos, secciones de distintas sedes, estados parciales, cancelados, filtros combinados, selección vacía, matrícula ausente, valores accesibles, tabla de detalle y errores de actualización.

Con SQL, Azurite y la API local iniciados, se comprobaron 12 sedes para el portafolio completo, 10 al seleccionar Finalizados y una al seleccionar Aurora. Aurora y Finalizados entrega dos proyectos, 20 de 24 estudiantes participantes (83,3%) y 6 de 6 hitos locales completados (100%). El resumen global de esos proyectos mantiene sus otras secciones, con 60 participantes de 72 estudiantes. Una búsqueda sin coincidencias devuelve cero sedes.

En el navegador se verificaron las 24 barras del portafolio, las 12 filas de la tabla, una búsqueda sin coincidencias y la combinación de sede y estado. Se revisó la presentación en el ancho disponible de 650 px, sin desbordamiento de los gráficos. Evidencias: `.local/logs/seguimiento-graficos-sede.jpg`, `.local/logs/monitoring-campus-checks.json` y `.local/logs/verify-monitoring-campus.log`.

## Gráficos por sede en Excel · 5 de noviembre de 2026

La descarga agrega la hoja «Comparación por sede» con tabla, filtros y dos gráficos de barras nativos editables: participación estudiantil y avance de hitos por sección. Los gráficos referencian la tabla de esa hoja y usan las mismas cifras filtradas que la pantalla; se conservan las siete hojas anteriores. Los porcentajes se guardan como proporciones numéricas, con formato porcentual, fórmulas IF/ROUND y sus resultados calculados. La ausencia de matrícula se distingue del cero real y queda fuera de las cachés numéricas de participación.

`npm run local:verify` aprobó aislamiento, lint, compilación, 55 pruebas frontend y 249 API: 304 pruebas distintas. Las cuatro pruebas nuevas verifican filtros combinados, referencias y cachés de los gráficos, escala y origen en cero, relaciones internas del paquete, XML válido, caracteres especiales, búsqueda literal comenzada con «=», selección vacía y falta de matrícula.

Con SQL, Azurite y la API local iniciados, se descargaron y verificaron estos libros:

| Selección | Proyectos | Sedes en la comparación | Gráficos |
| --- | ---: | ---: | ---: |
| Portafolio completo | 81 | 12 | 2 |
| Finalizados | 5 | 10 | 2 |
| Aurora, Finalizados y búsqueda DEMO26 | 2 | 1 | 2 |
| Búsqueda sin coincidencias | 0 | 0 | 0 |

Cada fila de la hoja y cada punto de las series coincide con `campusComparisons` de la API para la misma selección. Aurora y Finalizados conserva 20 de 24 participantes (83,3%) y 6 de 6 hitos completados (100%). Se importaron los gráficos nativos en el motor de lectura/renderizado de hojas y se revisaron visualmente el portafolio completo y la selección de una sede. Se corrigieron el cruce de ejes en cero, el espacio de etiquetas al 100% y el tamaño de gráficos con una sola sede. Esta comprobación no utilizó Excel Desktop.

Evidencias locales ignoradas por Git: `.local/logs/excel-sedes-checks.json`, `.local/logs/excel-sedes-completo.xlsx`, `.local/logs/excel-sedes-aurora-finalizados.xlsx`, `.local/logs/excel-sedes-filtrado-preview.png`, `.local/logs/excel-sedes-completo-preview.png` y `.local/logs/verify-monitoring-excel-charts.log`.

## Integración de metricas · 14 de noviembre de 2026

`npm run local:verify` aprobó aislamiento, lint, 56 pruebas frontend, 250 pruebas API y compilación. Vite informó un paquete JavaScript minificado de más de 500 kB. Las pruebas cubren período y sede en proyectos con secciones de distintos períodos, conteos sin duplicados, el mínimo de evaluaciones en el desglose y la conservación de la valoración global.

Con SQL Server, Azurite, Functions y Vite locales iniciados, se contrastaron los conteos de video, deserción y escuelas con consultas SQL independientes. Se comprobó en Azurite la existencia de un video ficticio ya confirmado. Las descargas se abrieron con ExcelJS y se cotejaron con la API, incluyendo las hojas nuevas, la selección de período y la presencia de los gráficos nativos.

| Selección | Proyectos | Escuelas | Equipos con video | Deserción por proyecto | Gráficos |
| --- | ---: | ---: | ---: | ---: | ---: |
| Portafolio completo | 81 | 7 | 465 de 645 | 215 de 2.700 | 2 |
| Período 2026-2 | 81 | 7 | 465 de 645 | 215 de 2.700 | 2 |
| 2026-2, Horizonte, Finalizados, DEMO26 | 2 | 1 | 18 de 18 | 6 de 72 | 2 |
| Búsqueda sin coincidencias | 0 | 0 | Sin datos | Sin datos | 0 |

Administración y coordinación tuvieron acceso. Seguimiento y exportación devolvieron 403 para un docente y 401 sin sesión. Un período que excede el largo permitido devolvió 400. En el navegador, con coordinación ficticia, se comprobaron el filtro combinado, las cifras de la tabla, los gráficos de la sede y la conservación del estado de alertas. Los registros de la prueba y los Excel de DEMO26 quedan en `.local/logs/metricas-live.json`, `.local/logs/verify-metricas.log` y `.local/logs/metricas-*.xlsx`.
