// Convierte cada guía HTML de esta carpeta en PDF (A4) con el Chromium instalado.
const { chromium } = require("playwright");

const path = require("node:path");
const dir = __dirname;
const guias = process.argv.slice(2);
(async () => {
const browser = await chromium.launch();
for (const g of guias) {
  const page = await browser.newPage();
  await page.goto("file://" + path.join(dir, g + ".html"), { waitUntil: "networkidle" });
  await page.pdf({
    path: path.join(dir, "..", g + ".pdf"),
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate:
      '<div style="font-size:7.5pt;color:#8a90a0;width:100%;padding:0 15mm;display:flex;justify-content:space-between;font-family:Arial"><span>' +
      (g.includes("economica") ? "Guía económica del CRM · DTI S.L." : "Guía de uso del CRM · DTI S.L.") +
      '</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  console.log("PDF:", g);
}
await browser.close();
})();
