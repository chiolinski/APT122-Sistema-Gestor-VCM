# Demostración ampliada DEMO26

Escenario optativo y enteramente ficticio para explorar el sistema local. Agrega datos al escenario inicial; no lo restablece ni elimina registros o volúmenes.

## Preparación

SQL, Azurite y la API deben estar iniciados según README.md. Para generar el video sintético se requieren `ffmpeg` y `ffprobe` en PATH. No se utilizan videos de personas reales.

Desde la raíz:

```powershell
npm run local:demo
```

El ejecutor conecta exclusivamente con la API en `http://127.0.0.1:7076`, la base local protegida por `localSafety.js` y Azurite. Usa la cuenta ficticia `admin@example.test`. Si cambiaste su contraseña, proporciona `SHOWCASE_ADMIN_PASSWORD` sólo en el entorno de esa terminal.

## Datos agregados

| Entidad | Cantidad nueva |
| --- | ---: |
| Administradores | 5 |
| Coordinadores CITT | 20 |
| Directores de carrera | 25 |
| Docentes | 200 |
| Estudiantes | 2.880 |
| Socios formadores | 40 |
| Sedes | 10 |
| Escuelas | 6 |
| Asignaturas | 16 |
| Secciones | 240 |
| Proyectos | 80 |

Las cuentas se llaman `demo.admin001@example.test` a `demo.admin005@example.test`, `demo.coordinacion001@example.test` a `demo.coordinacion020@example.test`, `demo.direccion001@example.test` a `demo.direccion025@example.test` y `demo.docente001@example.test` a `demo.docente200@example.test`. La contraseña inicial es `LocalVCM2026!`.

Los primeros diez coordinadores también tienen docencia asignada. Cada proyecto tiene tres secciones en distintas sedes. Cada sección tiene doce alumnos; cuando completa Hito 1, diez quedan distribuidos en tres equipos, uno sin equipo y uno desertor. Los nombres, identificadores y RUT son exclusivamente sintéticos; todos los correos pertenecen a `example.test`.

## Recorrido

Hay cinco proyectos de cada escenario:

1. Planificado, sin hitos completados.
2. Hito 1 completo en una de tres secciones.
3. Hito 1 global completo, pendiente de programación.
4. Hito 2 programado para siete días después de la creación del escenario.
5. Hito 2 abierto, con enlaces de entrega y videos pendientes.
6. Un video confirmado por sección; quedan dos equipos pendientes.
7. Videos completos y revisión del socio sin respuestas.
8. Revisión parcial del socio, todavía abierta.
9. Retroalimentación final pendiente de cierre docente. Incluye cierres completos por el socio y cierres internos parciales autorizados.
10. Hito 2 cerrado en una de tres secciones.
11. Hito 2 global completo, Hito 3 pendiente.
12. Hito 3 cerrado en una de tres secciones.
13. Proyecto finalizado en todas sus secciones.
14. Proyecto finalizado y posteriormente reabierto en Hito 2 para una sección, conservando auditoría e historia.
15. Enlace del socio vencido con dos evaluaciones guardadas por sección.
16. Revisión revocada; videos conservados y sección preparada para publicar otra revisión.

Los proyectos tienen antecedentes de texto descargables. Las secciones con Hito 2 abierto incluyen informes de texto y, según su escenario, videos MP4 H.264 de tres segundos generados mediante un patrón visual rotulado como ficticio. Las evaluaciones, avances y conclusiones son ficticios. Las notificaciones y reportes se derivan de estos estados reales.

## Conservación y reanudación

Las operaciones de cuentas, importación académica, proyectos, equipos, archivos, entregas, evaluaciones, cierres, revocaciones y reaperturas pasan por los endpoints reales. No se escriben estados de hitos directamente en SQL.

La única escritura SQL especial simula el paso del tiempo para los enlaces vencidos: modifica fechas de una revisión y de sus evaluaciones, verifica que pertenezcan a un proyecto DEMO26 creado por este ejecutor y registra una auditoría obligatoria en la misma transacción. No modifica estados de hitos ni respuestas.

Antes de crear datos se comprueban colisiones de códigos, correos y RUT. Se guardan únicamente identificadores y hashes de los registros previos para comprobar que sus datos se conservan. Se excluyen las sesiones y los campos volátiles que el inicio de sesión legítimo actualiza en las cuentas.

El avance, enlaces temporales y archivos generados viven en `.local/showcase/`, ignorado por Git. El catálogo para explorar es `.local/showcase/GUIA.md`; las cuentas se listan en `cuentas.csv`.

Se conserva `state.json` para reanudar tras un error. Al repetir una ejecución completada se verifican los datos y se preservan los cambios posteriores del usuario. Si se pierde ese estado pero existen entidades DEMO26, el ejecutor se detiene ante las colisiones en vez de reemplazarlas. No borres el estado para reinicializar ni ejecutes cargas simultáneas.

Los enlaces vencen naturalmente. Las descripciones reflejan el estado al crear la demostración; las pruebas manuales posteriores pueden modificarlo.
