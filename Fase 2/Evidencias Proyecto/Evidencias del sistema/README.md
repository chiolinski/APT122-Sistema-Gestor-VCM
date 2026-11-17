# VCM Piloto 2026 · entorno local de pruebas

Copia independiente del sistema piloto. Frontend React/Vite, API Azure Functions, SQL Server Developer y Azurite en este equipo. No contiene una copia de la base productiva. No es un despliegue de producción.

Consulta el [cierre técnico de APT122](docs/CIERRE_TECNICO.md) para los diagramas, requisitos y pruebas.

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

## Arranque completo con Docker

Usa Docker Desktop con contenedores Linux o Docker Engine con Compose v2. Node.js en el equipo genera la configuración inicial. La imagen incluye el runtime de Functions y la web compilada. Libera el puerto 5176 si tienes Vite iniciado.

```powershell
npm run local:configure
docker compose -f compose.yaml -f compose.app.yaml build app
docker compose -f compose.yaml -f compose.app.yaml run --rm app node scripts/docker-local.cjs --setup
docker compose -f compose.yaml -f compose.app.yaml up -d --wait app
```

Abre [la aplicación local](http://127.0.0.1:5176). Comprueba el estado de la base con [la ruta de salud](http://127.0.0.1:5176/api/health). El paso `--setup` prepara SQL, los contenedores privados de Azurite y las cuentas ficticias. Repítelo al incorporar migraciones locales. Los dos modos de arranque usan los mismos volúmenes del proyecto.

```powershell
npm run test:performance -- --docker
docker compose -f compose.yaml -f compose.app.yaml logs app --tail 50
docker compose -f compose.yaml -f compose.app.yaml stop
```

La prueba de rendimiento usa `admin@example.test`. Si cambiaste esa contraseña ficticia, configura `VCM_TEST_ADMIN_PASSWORD` en la terminal. La prueba mide consultas y expide nueve archivos Excel en memoria, incluido el calentamiento. La API registra la auditoría normal de esas exportaciones.

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

## Demostración ampliada opcional

Con los servicios locales iniciados, `npm run local:demo` agrega 250 cuentas internas, 2.880 estudiantes, 40 socios y 80 proyectos ficticios en distintos hitos. Requiere `ffmpeg` y `ffprobe` para los videos sintéticos. Conserva los datos existentes y permite reanudar una carga interrumpida. Consulta [DEMOSTRACION_LOCAL.md](DEMOSTRACION_LOCAL.md) para las cuentas, los escenarios y el funcionamiento de la carga.

Para reproducir la demostración DUOC26, ejecuta `npm run local:demo:duoc` con la API y la infraestructura locales iniciadas en modo desarrollo. En Seguimiento, busca `DUOC26` y selecciona el período `2026-2`. Consulta la [guía del escenario](DEMOSTRACION_LOCAL.md#demostraci%C3%B3n-de-inform%C3%A1tica-y-telecomunicaciones-de-duoc-uc).

## Git e incorporación de cambios

El Git de esta carpeta se inicializó en `main`. La referencia académica es [APT122-Sistema-Gestor-VCM](https://github.com/chiolinski/APT122-Sistema-Gestor-VCM), donde el código se encuentra en `Fase 2/Evidencias Proyecto/Evidencias del sistema/`. Consulta [CONTEXTO_PROYECTO.md](CONTEXTO_PROYECTO.md) para comparar versiones desde esa ruta.

Si partes de una copia de archivos entregada sin `.git`, puedes crear un historial local desde su raíz:

```powershell
git init -b main
git add .
git commit -m "Crear entorno local independiente de VCM 2026"
```

Si Docker no responde, inicia Docker Desktop. Si `func` no se reconoce, instala Azure Functions Core Tools v4 antes de arrancar la API. Para errores de SQL: `docker compose logs sql`. Si cambias la contraseña SQL después de crear un volumen, el servidor conserva la contraseña anterior: conserva `.env` y no cambies sus valores aisladamente.
