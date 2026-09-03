import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const templatePath = join(packageRoot, "page.template.html")
const cssPath = join(packageRoot, "profiler.css")
const outputPath = join(packageRoot, "index.html")

let html = await readFile(templatePath, "utf8")
const css = await readFile(cssPath, "utf8")

html = html.replace(
  '    <link rel="stylesheet" href="./profiler.css" />',
  `    <style>\n${css}\n    </style>`
)

const diagramPattern = /src="\.\/diagrams\/([a-z0-9-]+\.svg)"/g
const diagramNames = [...html.matchAll(diagramPattern)].map((match) => match[1])

for (const name of new Set(diagramNames)) {
  const svg = await readFile(join(packageRoot, "diagrams", name))
  const dataUrl = `data:image/svg+xml;base64,${svg.toString("base64")}`
  html = html.replaceAll(`src="./diagrams/${name}"`, `src="${dataUrl}"`)
}

if (html.includes('href="./profiler.css"') || html.includes('src="./diagrams/')) {
  throw new Error("The generated page still contains local stylesheet or diagram references")
}

await writeFile(outputPath, html)
console.log(`Built self-contained page with ${new Set(diagramNames).size} embedded diagrams`)
