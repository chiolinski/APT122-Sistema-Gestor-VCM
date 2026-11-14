const JSZip = require("jszip");

const SHEET_NAME = "Comparación por sede";
const FIRST_DATA_ROW = 9;
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);

function addCampusComparisonSheet(workbook, report) {
  const campuses = report.campusComparisons || [];
  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", ySplit: FIRST_DATA_ROW - 1 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [48, 12, 18, 18, 17, 14, 19, 19, 17].map((width) => ({ width }));
  sheet.mergeCells("A1:I1");
  sheet.getCell("A1").value = SHEET_NAME;
  sheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF171717" } };
  sheet.getRow(1).height = 34;
  const filters = report.filters || {};
  const metadata = [
    ["Sede", filters.campus && filters.campus !== "all" ? filters.campus : "Todas las sedes"],
    ["Estado", { all: "Todos", attention: "Requieren atención", ready: "Listos para avanzar", finished: "Finalizados" }[filters.scope || "all"]],
    ["Búsqueda", filters.search || "Sin búsqueda"],
    ["Datos generados", report.generatedAt || ""],
    ["Período académico", filters.period || "Todos los períodos"],
  ];
  metadata.forEach(([label, value], index) => {
    const row = index + 2;
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 1).font = { bold: true, size: 10 };
    sheet.mergeCells(`B${row}:I${row}`);
    // Valores de texto, incluso si la búsqueda comienza con un signo igual.
    sheet.getCell(row, 2).value = value;
    sheet.getCell(row, 2).font = { size: 10 };
    sheet.getCell(row, 2).alignment = { wrapText: true, vertical: "middle" };
    sheet.getRow(row).height = 28;
  });
  sheet.mergeCells("A7:I7");
  sheet.getCell("A7").value = "Sin proyectos cancelados. Cada sede cuenta sus estudiantes una sola vez; personas y proyectos pueden figurar en varias sedes y no se suman. El avance mide los hitos de las secciones de cada sede; los hitos globales requieren todas las secciones del proyecto. Sin matrícula, no se calcula ni grafica participación.";
  sheet.getCell("A7").font = { size: 10, color: { argb: "FF62625C" } };
  sheet.getCell("A7").alignment = { wrapText: true, vertical: "middle" };
  sheet.getRow(7).height = 44;
  const headers = ["Sede", "Proyectos", "Estudiantes en nómina", "Estudiantes con equipo", "Participación", "Secciones", "Hitos completados", "Total de hitos", "Avance de hitos"];
  sheet.getRow(8).values = headers;
  sheet.getRow(8).height = 34;
  sheet.getRow(8).eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FF171717" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFB800" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  campuses.forEach((campus, index) => {
    const row = FIRST_DATA_ROW + index;
    sheet.getRow(row).values = [campus.campusName, campus.projectCount, campus.enrolledStudents, campus.participatingStudents,
      { formula: `IF(C${row}=0,"Sin matrícula",ROUND(D${row}/C${row},3))`, result: campus.studentParticipationPercent === null ? "Sin matrícula" : campus.studentParticipationPercent / 100 },
      campus.totalSections, campus.completedSectionMilestones, campus.totalSectionMilestones,
      { formula: `IF(H${row}=0,0,ROUND(G${row}/H${row},3))`, result: campus.sectionProgressPercent / 100 }];
    sheet.getRow(row).height = Math.max(32, Math.ceil(campus.campusName.length / 44) * 15);
    sheet.getRow(row).eachCell((cell) => {
      cell.font = { size: 10, color: { argb: "FF171717" } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: "FFE3E3DF" } } };
      if (index % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAF8" } };
    });
    [5, 9].forEach((column) => { sheet.getCell(row, column).numFmt = "0.0%"; });
  });
  sheet.autoFilter = `A8:I${Math.max(8, FIRST_DATA_ROW + campuses.length - 1)}`;
  if (!campuses.length) {
    sheet.mergeCells("A9:I9");
    sheet.getCell("A9").value = "No hay sedes con proyectos para estos filtros.";
    sheet.getRow(9).height = 30;
  }
  sheet.headerFooter.oddFooter = "&LSeguimiento VCM 2026&C&P de &N&RComparación por sede";
  const chartRows = Math.max(12, campuses.length * 2 + 7);
  const chartStart = FIRST_DATA_ROW + campuses.length + 2;
  if (campuses.length && campuses.every((campus) => campus.studentParticipationPercent === null)) {
    sheet.mergeCells(`A${chartStart}:I${chartStart}`);
    sheet.getCell(`A${chartStart}`).value = "Participación estudiantil: sin matrícula para calcular el gráfico.";
  }
  sheet.pageSetup.printArea = `A1:I${campuses.length ? chartStart + chartRows * 2 + 4 : 9}`;
  return { sheetId: sheet.id, campuses, chartStart, chartRows };
}

function chartXml({ title, column, field, color }, campuses) {
  const lastRow = FIRST_DATA_ROW + campuses.length - 1;
  const source = `'${SHEET_NAME}'!`;
  const categories = campuses.map((campus, index) => `<c:pt idx="${index}"><c:v>${escapeXml(campus.campusName)}</c:v></c:pt>`).join("");
  const values = campuses.map((campus, index) => campus[field] === null ? "" : `<c:pt idx="${index}"><c:v>${campus[field] / 100}</c:v></c:pt>`).join("");
  return `${XML}<c:chartSpace xmlns:c="${DRAWING_NS}/chart" xmlns:a="${DRAWING_NS}/main" xmlns:r="${REL_NS}">
    <c:lang val="es-CL"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:t>${escapeXml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>
    <c:plotArea><c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="factor"/><c:yMode val="factor"/><c:wMode val="factor"/><c:hMode val="factor"/><c:x val="0.2"/><c:y val="0.14"/><c:w val="0.73"/><c:h val="0.72"/></c:manualLayout></c:layout><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>
      <c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${escapeXml(title)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>
      <c:cat><c:strRef><c:f>${escapeXml(source)}$A$${FIRST_DATA_ROW}:$A$${lastRow}</c:f><c:strCache><c:ptCount val="${campuses.length}"/>${categories}</c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:f>${escapeXml(source)}$${column}$${FIRST_DATA_ROW}:$${column}$${lastRow}</c:f><c:numCache><c:formatCode>0.0%</c:formatCode><c:ptCount val="${campuses.length}"/>${values}</c:numCache></c:numRef></c:val></c:ser>
      <c:dLbls><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/></c:dLbls><c:gapWidth val="${campuses.length === 1 ? 300 : 70}"/><c:axId val="1"/><c:axId val="2"/></c:barChart>
      <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>
      <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/><c:max val="1"/><c:min val="0"/></c:scaling><c:axPos val="b"/><c:majorGridlines/><c:numFmt formatCode="0%" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/><c:crosses val="max"/><c:crossBetween val="between"/><c:majorUnit val="0.25"/></c:valAx>
    </c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>
    <c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="E3E3DF"/></a:solidFill></a:ln></c:spPr>
    <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr><a:endParaRPr lang="es-CL"/></a:p></c:txPr></c:chartSpace>`;
}

// ExcelJS genera las hojas; los gráficos nativos OOXML se incorporan al final,
// porque ExcelJS 4 no los escribe ni los conserva al volver a guardar un libro.
async function attachCampusCharts(buffer, { sheetId, campuses, chartStart, chartRows }) {
  if (!campuses.length) return Buffer.from(buffer);
  const definitions = [
    { title: "Participación estudiantil por sede", column: "E", field: "studentParticipationPercent", color: "287757" },
    { title: "Avance de hitos por sección y sede", column: "I", field: "sectionProgressPercent", color: "326B92" },
  ].map((definition, slot) => ({ ...definition, slot }))
    .filter((definition) => campuses.some((campus) => campus[definition.field] !== null));
  const zip = await JSZip.loadAsync(buffer);
  const drawingName = "monitoringCampus";
  const drawingPath = `xl/drawings/${drawingName}.xml`;
  const sheetPath = `xl/worksheets/sheet${sheetId}.xml`;
  const sheetRelPath = `xl/worksheets/_rels/sheet${sheetId}.xml.rels`;
  if (zip.file(drawingPath) || zip.file(sheetRelPath)) throw new Error("La hoja de comparación ya contiene dibujos.");
  const anchors = [];
  const relationships = [];
  const contentTypes = [];
  definitions.forEach((definition, index) => {
    const id = index + 1;
    const name = `monitoringCampus${id}`;
    const top = chartStart - 1 + definition.slot * (chartRows + 2);
    zip.file(`xl/charts/${name}.xml`, chartXml(definition, campuses));
    relationships.push(`<Relationship Id="rId${id}" Type="${REL_NS}/chart" Target="../charts/${name}.xml"/>`);
    contentTypes.push(`<Override PartName="/xl/charts/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
    anchors.push(`<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${top}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${top + chartRows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${escapeXml(definition.title)}" descr="${escapeXml(definition.title)}. Escala de 0 a 100%. Datos en la tabla de esta hoja."/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${DRAWING_NS}/chart"><c:chart xmlns:c="${DRAWING_NS}/chart" xmlns:r="${REL_NS}" r:id="rId${id}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`);
  });
  zip.file(drawingPath, `${XML}<xdr:wsDr xmlns:xdr="${DRAWING_NS}/spreadsheetDrawing" xmlns:a="${DRAWING_NS}/main">${anchors.join("")}</xdr:wsDr>`);
  zip.file(`xl/drawings/_rels/${drawingName}.xml.rels`, `${XML}<Relationships xmlns="${PACKAGE_REL_NS}">${relationships.join("")}</Relationships>`);
  zip.file(sheetRelPath, `${XML}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rIdCampusCharts" Type="${REL_NS}/drawing" Target="../drawings/${drawingName}.xml"/></Relationships>`);
  const sheetXml = await zip.file(sheetPath).async("string");
  zip.file(sheetPath, sheetXml.replace("</worksheet>", '<drawing r:id="rIdCampusCharts"/></worksheet>'));
  const typesXml = await zip.file("[Content_Types].xml").async("string");
  contentTypes.push(`<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  zip.file("[Content_Types].xml", typesXml.replace("</Types>", `${contentTypes.join("")}</Types>`));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

module.exports = { addCampusComparisonSheet, attachCampusCharts };
