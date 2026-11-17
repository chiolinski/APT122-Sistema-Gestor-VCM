const { createHash } = require("node:crypto");

const SCHOOL_NAME = "Informática y Telecomunicaciones";
const CAMPUSES = ["Maipú", "Plaza Norte", "Plaza Oeste", "Plaza Vespucio", "San Joaquín", "Viña del Mar"];
const CAREERS = {
  informatica: "Ingeniería en Informática",
  programacion: "Analista Programador",
  redes: "Ingeniería en Redes y Telecomunicaciones",
};

const CASES = [
  ["informatica", "Desarrollo web", "Portal de talleres comunitarios"],
  ["programacion", "Bases de datos", "Inventario para una biblioteca comunitaria"],
  ["informatica", "Integración de sistemas", "Agenda digital para una junta vecinal"],
  ["redes", "Diseño de redes", "Diseño wifi para un centro comunitario"],
  ["programacion", "Programación de aplicaciones", "Registro de préstamos de un taller vecinal"],
  ["informatica", "Analítica de datos", "Tablero de participación para una agrupación deportiva"],
  ["redes", "Seguridad de redes", "Segmentación wifi para una biblioteca comunitaria"],
  ["programacion", "Aplicaciones móviles", "Buscador de puntos de reciclaje"],
  ["informatica", "Pruebas de software", "Validación de accesibilidad de un portal vecinal"],
  ["redes", "Monitoreo de redes", "Alertas de conectividad para una cooperativa barrial"],
  ["programacion", "Desarrollo de API", "Catálogo de servicios para una agrupación de oficios"],
  ["informatica", "Automatización de procesos", "Gestión de inscripciones a actividades comunitarias"],
  ["redes", "Servicios de red", "Laboratorio de acceso remoto para alfabetización digital"],
  ["programacion", "Interfaces de usuario", "Agenda accesible de voluntariado"],
  ["informatica", "Seguridad de aplicaciones", "Revisión de seguridad de un portal comunitario"],
  ["redes", "Infraestructura de telecomunicaciones", "Plan de continuidad de conectividad vecinal"],
];

const FIRST_NAMES = [
  "Agustina", "Alonso", "Amalia", "Antonia", "Benjamín", "Bruno", "Camila", "Catalina", "Constanza", "Daniela",
  "Diego", "Elisa", "Emilia", "Esteban", "Fernanda", "Francisca", "Gabriel", "Ignacio", "Isidora", "Javiera",
  "Joaquín", "Josefa", "Laura", "Leonardo", "Lucas", "Maite", "Martín", "Matías", "Nicolás", "Paula",
  "Rafael", "Renata", "Sebastián", "Sofía", "Tomás", "Valentina", "Vicente", "Violeta",
];
const LAST_NAMES = [
  "Aguilera", "Alarcón", "Arriagada", "Bahamondes", "Bustos", "Cáceres", "Campos", "Carrasco", "Contreras", "Cortés",
  "Escobar", "Espinoza", "Figueroa", "Fuentes", "Gallardo", "Henríquez", "Jara", "Leiva", "Lillo", "Maldonado",
  "Mardones", "Molina", "Morales", "Muñoz", "Navarro", "Ojeda", "Orellana", "Paredes", "Peña", "Pino",
  "Riquelme", "Rojas", "Salas", "Sanhueza", "Sepúlveda", "Soto", "Tapia", "Toledo", "Urrutia", "Vera",
];

function createNameGenerator() {
  // Los nombres se generan a partir de identificadores de prueba para que la carga sea reproducible.
  const used = new Set();
  return (identifier) => {
    for (let attempt = 0; ; attempt += 1) {
      const bytes = createHash("sha256").update(`duoc-showcase-v1:${identifier}:${attempt}`).digest();
      const first = FIRST_NAMES[bytes.readUInt16BE(0) % FIRST_NAMES.length];
      const paternal = bytes.readUInt16BE(2) % LAST_NAMES.length;
      const maternal = (paternal + 1 + bytes.readUInt16BE(4) % (LAST_NAMES.length - 1)) % LAST_NAMES.length;
      const name = `${first} ${LAST_NAMES[paternal]} ${LAST_NAMES[maternal]}`;
      if (used.has(name)) continue;
      used.add(name);
      return name;
    }
  };
}

module.exports = { SCHOOL_NAME, CAMPUSES, CAREERS, CASES, createNameGenerator };
