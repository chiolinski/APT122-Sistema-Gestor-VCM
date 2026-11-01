# VCM Piloto 2026 · entorno local de pruebas

Copia independiente del sistema piloto. Frontend React/Vite, API Azure Functions, SQL Server Developer y Azurite en este equipo. No contiene una copia de la base productiva. No es un despliegue de producción.

## Requisitos

- Node.js 22 LTS y npm.
- Docker Desktop iniciado, en modo contenedores Linux; reserva al menos 4 GB de memoria.
- Azure Functions Core Tools v4 (`func --version`). Debe estar instalado y disponible en PATH.
- Puertos libres: 5176, 4176, 7076, 14333 y 10000–10002.

La primera instalación descarga paquetes npm e imágenes de contenedores. Una vez instalados, la aplicación utiliza servicios locales.

## Primera preparación (PowerShell, desde esta carpeta)

```powershell
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
npm run local:verify         # aislamiento, lint, tests frontend/API y build
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
