# Sistema Gestor de Proyectos VCM

Proyecto académico APT122 para gestionar proyectos de Vinculación con el Medio. La aplicación de pruebas usa React, Azure Functions, SQL Server y Azurite con datos ficticios.

## Entrega final de Fase 2

| Entregable | Archivo |
| --- | --- |
| Informe final con índice y anexos | [Word](Fase%202/Evidencias%20Grupales/APT122_Informe_Final_Proyecto_VCM.docx) · [PDF](Fase%202/Evidencias%20Grupales/APT122_Informe_Final_Proyecto_VCM.pdf) |
| Presentación final | [PowerPoint](Fase%202/Evidencias%20Grupales/APT122_Presentacion_Final_Proyecto_VCM.pptx) |
| Planilla de evaluación | [Excel](Fase%202/Evidencias%20Grupales/APT122_Planilla_Evaluacion_Fase2.xlsx) |

## Navegación del repositorio

### Evidencias académicas

- [Fase 1](Fase%201/README.md) reúne la definición, la planificación y las evidencias de esa etapa.
- [Fase 2](Fase%202/README.md) enlaza las evidencias grupales e individuales, el avance y la entrega final.
- [Evidencias del proyecto](Fase%202/Evidencias%20Proyecto/README.md) reúne las épicas, el backlog, las historias de usuario y el modelo relacional del avance.

### Diseño y código

- [Cierre técnico](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/docs/CIERRE_TECNICO.md) reúne la [arquitectura](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/docs/CIERRE_TECNICO.md#1-arquitectura), el [modelo de datos actualizado](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/docs/CIERRE_TECNICO.md#2-modelo-de-datos) y los [diagramas UML](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/docs/CIERRE_TECNICO.md#3-diagramas-uml).
- [Fuentes de los diagramas](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/docs/diagramas/) y [código del sistema](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/).

### Arranque, demostración y pruebas

- [Arranque local con Docker](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/README.md#arranque-completo-con-docker), [Dockerfile](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/Dockerfile), [Compose de infraestructura](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/compose.yaml) y [Compose de aplicación](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/compose.app.yaml).
- [Guion docente de DUOC26-014](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/DEMOSTRACION_LOCAL.md#demostración-del-proyecto-duoc26-014) y [preparación de DUOC26](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/DEMOSTRACION_LOCAL.md#demostración-de-informática-y-telecomunicaciones-de-duoc-uc).
- [Resultados de las pruebas](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/VERIFICACION.md) y [verificación de DUOC26](Fase%202/Evidencias%20Proyecto/Evidencias%20del%20sistema/VERIFICACION.md#duoc26-en-la-copia-académica).

## Requisitos

- Node.js 22 LTS y npm.
- Docker Desktop iniciado, en modo contenedores Linux; reserva al menos 4 GB de memoria.
- Azure Functions Core Tools v4 (`func --version`). Debe estar instalado y disponible en PATH.
- Puertos libres: 5176, 4176, 7076, 14333 y 10000–10002.

La primera instalación descarga paquetes npm e imágenes de contenedores. Una vez instalados, la aplicación utiliza servicios locales.

## Primera preparación en modo desarrollo

Ejecuta esta secuencia desde la raíz del repositorio. Para el arranque completo en contenedores, sigue la guía de Docker enlazada arriba.

```powershell
Set-Location 'Fase 2/Evidencias Proyecto/Evidencias del sistema'
npm ci
npm --prefix api ci
npm run local:configure
npm run local:infra
npm run local:setup
```

`local:configure` genera una contraseña SQL aleatoria en `.env` y `api/local.settings.json`, ambos ignorados por Git. No copies configuraciones ni credenciales del sistema productivo. Si tu consola tiene variables Azure/SQL de otro proyecto, abre una consola sin esas variables: las conexiones ajenas serán rechazadas.

Inicia la API en una terminal:

```powershell
npm run local:api
```

Inicia la web en otra terminal:

```powershell
npm run dev
```

Abre **http://127.0.0.1:5176**. Usa esta dirección exacta para las cookies, los videos y CORS. `npm run build` y `npm run preview` permiten probar la compilación en http://127.0.0.1:4176 con la misma API local.

## Usuarios ficticios

Todas las cuentas nuevas utilizan `LocalVCM2026!`:

| Correo | Perfil |
| --- | --- |
| admin@example.test | Administrador |
| coordinacion@example.test | Coordinador CITT |
| direccion@example.test | Director de Carrera |
| docente1@example.test | Docente de la sección 001D |
| docente2@example.test | Docente de la sección 002D |

La carga inicial crea dos sedes ficticias, una asignatura LOCAL101, dos secciones, doce estudiantes, un socio ficticio y un proyecto con tres hitos por sección. Los RUT son valores generados para pruebas, sin relación con personas u organizaciones reales. Los correos pertenecen a example.test. No se envían correos.

`npm run local:setup` se puede repetir: omite migraciones e importaciones ya aplicadas y no restablece cuentas existentes. Los videos no incluyen grabaciones: se deben cargar MP4 de prueba desde el flujo de Hito 2.

## Uso diario y pruebas

```powershell
npm run local:infra          # iniciar contenedores
npm run local:api            # terminal 1
npm run dev                  # terminal 2
npm run local:demo           # opcional: cargar datos de demostración ampliados
npm run local:demo:duoc      # opcional: cargar el escenario ficticio DUOC26
npm run local:verify         # aislamiento, lint, tests frontend/API y build
npm run test:integration     # pruebas de integración con SQL y API locales
npm run test:performance     # tiempos de respuesta de Seguimiento y Excel
npm run local:stop           # detener contenedores conservando datos
```

Verificación manual sugerida: entrar como administrador, comprobar la carga y las cinco cuentas; entrar como coordinación y revisar el proyecto; entrar como cada docente, comprobar que ve únicamente su sección y formar equipos; completar Hito 1, programar Hito 2, cargar videos ficticios, evaluar con un enlace de socio, revisar la retroalimentación y cerrar cada sección. Probar seguimiento, reportes, archivos, auditoría y reaperturas.

SQL se conserva en el volumen Docker de este proyecto y los archivos en otro volumen. Mover la carpeta no traslada automáticamente esos volúmenes: en otro equipo se reconstruyen datos ficticios con los mismos pasos. No ejecutar `docker compose down -v` salvo que se quiera borrar deliberadamente todos los datos y archivos locales.

## ¿Qué hace la plataforma?
La plataforma digitaliza el ciclo de los proyectos VCM y reúne en un solo sistema la información académica y operativa necesaria para su gestión.

## Integrantes
- Israel Del Pino Burdiles (`Isra-delpino`)
- Rocío Rodríguez Urrutia (`chiolinski`)
- Pablo Sepúlveda Daza (`PabSepul`)

---

## 📄 Licencia y Derechos de Uso

Este repositorio ha sido desarrollado exclusivamente como material académico para la asignatura **Capstone**. 

Queda estrictamente prohibido cualquier uso, copia, modificación, distribución o reproducción total o parcial de este código y sus recursos fuera del ámbito del desarrollo de dicha asignatura, salvo autorización expresa y por escrito de los autores.

*© 2026. Todos los derechos reservados por los autores.*
