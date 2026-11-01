const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, validatePassword, verifyPassword } = require("../src/lib/password");

test("genera un hash scrypt verificable sin almacenar la contraseña", async () => {
  const password = "PilotoSeguro2026";
  const hash = await hashPassword(password);
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(hash.includes(password), false);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("OtraClave2026", hash), false);
});

test("cada contraseña recibe una sal distinta", async () => {
  const first = await hashPassword("PilotoSeguro2026");
  const second = await hashPassword("PilotoSeguro2026");
  assert.notEqual(first, second);
});

test("rechaza contraseñas cortas o sin números", () => {
  assert.throws(() => validatePassword("corta1"), { code: "WEAK_PASSWORD" });
  assert.throws(() => validatePassword("una clave muy larga"), { code: "WEAK_PASSWORD" });
});

test("verifica las cuatro credenciales del script SQL manual", async () => {
  const credentials = [
    ["AdminVCM2026!", "scrypt$16384$8$1$c1307456d0878b0c077bf20133fcfd59$fce33992ab88dd1be2793630fd2b6c33e8a62afc5a732a1cc07becf3da6db2600dff72da8bc0577dbc42b870e46e0081b13eaa1dc98580ebc535d8e44fc107d1"],
    ["CoordVCM2026!", "scrypt$16384$8$1$eb4e1b7fa9ff3d65abb4b50f5afa6f07$04e46b337dcc8590f7673e4d414066efb4a73637cae1b5cb166d85e5e3baacb0d9d2d8d31404c86f8d62e3f1e9595c54d4227a5943ee5adaae6e405d4d446e4e"],
    ["DirectorVCM2026!", "scrypt$16384$8$1$610ceaeccd2940970c34589015c78480$17bf242f1a8d18bc86f969bd5223447d136ede30eae5e45fd0e1209a5ec29b4ccb8583aaa2b24e59ee5c6c31a9765da392e03b354a9ea9e394becd0d59f48ea5"],
    ["DocenteVCM2026!", "scrypt$16384$8$1$b63bfe75a608a764b1c9bf39fa784438$5d5bf8d08c7fc9a02376826b8aa5a15d47e98dea70dd49550defb77a0a55823406889a86832203884255107c75795d4f16d32a01f825f3803bd6461e0d0aa707"],
  ];
  const results = await Promise.all(credentials.map(([password, hash]) => verifyPassword(password, hash)));
  assert.deepEqual(results, [true, true, true, true]);
});
