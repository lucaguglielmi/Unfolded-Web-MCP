/**
 * Empty stand-in for jsPDF's optional dependencies (html2canvas, dompurify,
 * canvg). They exist only for jsPDF's `.html()` and `.addSvgAsImage()`
 * features, which this app never calls — our pipeline is svg2pdf for
 * vectors and addImage for the QR. Aliasing them here (see vite.config.ts)
 * keeps ~380 kB of dead code out of the deploy artifact. If one of those
 * jsPDF features is ever adopted, remove the alias for its dependency.
 */
export default undefined
