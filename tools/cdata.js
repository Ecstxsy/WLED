/**
 * Writes compressed C arrays of data files (web interface)
 * How to use it?
 *
 * 1) Install Node 11+ and npm
 * 2) npm install
 * 3) npm run build
 *
 * If you change data folder often, you can run it in monitoring mode (it will recompile and update *.h on every file change)
 *
 * > npm run dev
 *
 * How it works?
 *
 * It uses NodeJS packages to inline, minify and GZIP files. See writeHtmlGzipped and writeChunks invocations at the bottom of the page.
 */

const fs = require("fs");
const packageJson = require("../package.json");

/**
 *
 */
function hexdump(buffer) {
  let lines = [];

  for (let i = 0; i < buffer.length; i += 16) {
    let block = buffer.slice(i, i + 16); // cut buffer into blocks of 16
    let hexArray = [];

    for (let value of block) {
      hexArray.push("0x" + value.toString(16).padStart(2, "0"));
    }

    let hexString = hexArray.join(", ");
    let line = `  ${hexString}`;
    lines.push(line);
  }

  return lines.join(",\n");
}

const inliner = require("inliner");
const zlib = require("zlib");

function strReplace(str, search, replacement) {
  return str.split(search).join(replacement);
}

function adoptVersionAndRepo(html) {
  let repoUrl = packageJson.repository ? packageJson.repository.url : undefined;
  if (repoUrl) {
    repoUrl = repoUrl.replace(/^git\+/, "");
    repoUrl = repoUrl.replace(/\.git$/, "");
    // Replace we
    html = strReplace(html, "https://github.com/atuline/WLED", repoUrl);
    html = strReplace(html, "https://github.com/Aircoookie/WLED", repoUrl);
  }

  let version = packageJson.version;
  if (version) {
    html = strReplace(html, "##VERSION##", version);
  }

  return html;
}

function writeHtmlGzipped(sourceFile, resultFile) {
  console.info("Reading " + sourceFile);
  new inliner(sourceFile, function (error, html) {
    console.info("Inlined " + html.length + " characters");

    if (error) {
      console.warn(error);
      throw error;
    }

    html = adoptVersionAndRepo(html);
    zlib.gzip(html, { level: zlib.constants.Z_BEST_COMPRESSION }, function (error, result) {
      if (error) {
        console.warn(error);
        throw error;
      }

      console.info("Compressed " + result.length + " bytes");
      const array = hexdump(result);
      const src = `/*
 * Binary array for the Web UI.
 * gzip is used for smaller size and improved speeds.
 * 
 * Please see https://github.com/Aircoookie/WLED/wiki/Add-own-functionality#web-ui
 * to find out how to easily modify the web UI source!
 */
 
// Autogenerated from ${sourceFile}, do not edit!!
const uint16_t PAGE_index_L = ${result.length};
const uint8_t PAGE_index[] PROGMEM = {
${array}
};
`;
      console.info("Writing " + resultFile);
      fs.writeFileSync(resultFile, src);
    });
  });
}

const CleanCSS = require("clean-css");
const MinifyHTML = require("html-minifier").minify;

function filter(str, type) {
  str = adoptVersionAndRepo(str);

  if (type === undefined) {
    return str;
  } else if (type == "css-minify") {
    return new CleanCSS({}).minify(str).styles;
  } else if (type == "html-minify") {
    return MinifyHTML(str, {
      collapseWhitespace: true,
      maxLineLength: 80,
      minifyCSS: true,
      minifyJS: true,
      continueOnParseError: false,
      removeComments: true,
    });
  } else {
    console.warn("Unknown filter: " + type);
    return str;
  }
}

function specToChunk(srcDir, s) {
  if (s.method == "plaintext") {
    const buf = fs.readFileSync(srcDir + "/" + s.file);
    const str = buf.toString("ascii");
    const chunk = `
// Autogenerated from ${srcDir}/${s.file}, do not edit!!
const char ${s.name}[] PROGMEM = R"${s.prepend || ""}${filter(str, s.filter)}${
      s.append || ""
    }";

`;
    return s.mangle ? s.mangle(chunk) : chunk;
  } else if (s.method == "binary") {
    const buf = fs.readFileSync(srcDir + "/" + s.file);
    const result = hexdump(buf);
    const chunk = `
// Autogenerated from ${srcDir}/${s.file}, do not edit!!
const uint16_t ${s.name}_length = ${result.length};
const uint8_t ${s.name}[] PROGMEM = {
${result}
};

`;
    return s.mangle ? s.mangle(chunk) : chunk;
  } else {
    console.warn("Unknown method: " + s.method);
    return undefined;
  }
}

function writeChunks(srcDir, specs, resultFile) {
  let src = `/*
 * More web UI HTML source arrays.
 * This file is auto generated, please don't make any changes manually.
 * Instead, see https://github.com/Aircoookie/WLED/wiki/Add-own-functionality#web-ui
 * to find out how to easily modify the web UI source!
 */ 
`;
  specs.forEach((s) => {
    try {
      console.info("Reading " + srcDir + "/" + s.file + " as " + s.name);
      src += specToChunk(srcDir, s);
    } catch (e) {
      console.warn(
        "Failed " + s.name + " from " + srcDir + "/" + s.file,
        e.message.length > 60 ? e.message.substring(0, 60) : e.message
      );
    }
  });
  console.info("Writing " + src.length + " characters into " + resultFile);
  fs.writeFileSync(resultFile, src);
}

writeHtmlGzipped("wled00/data/index.htm", "wled00/html_ui.h");

writeChunks(
  "wled00/data",
  [
    {
      file: "style.css",
      name: "PAGE_settingsCss",
      prepend: "=====(<style>",
      append: "</style>)=====",
      method: "plaintext",
      filter: "css-minify",
    },
    {
      file: "settings.htm",
      name: "PAGE_settings",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
      mangle: (str) =>
        str
          .replace("%", "%%")
          .replace(/User Interface\<\/button\>\<\/form\>/gms, "User Interface\<\/button\>\<\/form\>%DMXMENU%"),
    },
    {
      file: "settings_wifi.htm",
      name: "PAGE_settings_wifi",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
      mangle: (str) =>
        str
          .replace(/\<link rel="stylesheet".*\>/gms, "")
          .replace(/\<style\>.*\<\/style\>/gms, "%CSS%%SCSS%")
          .replace(
            /function GetV().*\<\/script\>/gms,
            "function GetV() {var d=document;\n"
          ),
    },
    {
      file: "settings_leds.htm",
      name: "PAGE_settings_leds",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
      mangle: (str) =>
        str
          .replace(/\<link rel="stylesheet".*\>/gms, "")
          .replace(/\<style\>.*\<\/style\>/gms, "%CSS%%SCSS%")
          .replace(
            /function GetV().*\<\/script\>/gms,
            "function GetV() {var d=document;\n"
          ),
    },
    {
      file: "settings_dmx.htm",
      name: "PAGE_settings_dmx",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
      mangle: (str) => {
        const nocss = str
          .replace(/\<link rel="stylesheet".*\>/gms, "")
          .replace(/\<style\>.*\<\/style\>/gms, "%CSS%%SCSS%")
          .replace(
            /function GetV().*\<\/script\>/gms,
            "function GetV() {var d=document;\n"
          );
        return `
#ifdef WLED_ENABLE_DMX
${nocss}
#else
const char PAGE_settings_dmx[] PROGMEM = R"=====()=====";
#endif
`;
      },
    },
    {
      file: "settings_ui.htm",
      name: "PAGE_settings_ui",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
      mangle: (str) =>
        str
          .replace(/\<link rel="stylesheet".*\>/gms, "")
          .replace(/\<style\>.*\<\/style\>/gms, "%CSS%%SCSS%")
          .replace(
            /function GetV().*\<\/script\>/gms,
            "function GetV() {var d=document;\n"
          ),
    },
    {
      file: "settings_sync.htm",
      name: "PAGE_settings_sync",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
      mangle: (str) =>
        str
          .replace(/\<link rel="stylesheet".*\>/gms, "")
          .replace(/\<style\>.*\<\/style\>/gms, "%CSS%%SCSS%")
          .replace(/function GetV().*\<\/script\>/gms, "function GetV() {\n"),
    },
    {
      file: "settings_time.htm",
      name: "PAGE_settings_time",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
      mangle: (str) =>
        str
          .replace(/\<link rel="stylesheet".*\>/gms, "")
          .replace(/\<style\>.*\<\/style\>/gms, "%CSS%%SCSS%")
          .replace(/function GetV().*\<\/script\>/gms, "function GetV() {\n"),
    },
    {
      file: "settings_sec.htm",
      name: "PAGE_settings_sec",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
      mangle: (str) =>
        str
          .replace(/\<link rel="stylesheet".*\>/gms, "")
          .replace(/\<style\>.*\<\/style\>/gms, "%CSS%%SCSS%")
          .replace(
            /function GetV().*\<\/script\>/gms,
            "function GetV() {var d=document;\n"
          ),
    },
  ],
  "wled00/html_settings.h"
);

writeChunks(
  "wled00/data",
  [
    {
      file: "usermod.htm",
      name: "PAGE_usermod",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
      mangle: (str) =>
        str.replace(/fetch\("http\:\/\/.*\/win/gms, 'fetch("/win'),
    },
    {
      file: "msg.htm",
      name: "PAGE_msg",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
      mangle: (str) => str.replace(/\<h2\>.*\<\/body\>/gms, "<h2>%MSG%</body>"),
    },
    {
      file: "dmxmap.htm",
      name: "PAGE_dmxmap",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
      mangle: (str) => `
#ifdef WLED_ENABLE_DMX
${str.replace(/function FM\(\)[ ]?\{/gms, "function FM() {%DMXVARS%\n")}
#else
const char PAGE_dmxmap[] PROGMEM = R"=====()=====";
#endif
`,
    },
    {
      file: "update.htm",
      name: "PAGE_update",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
    },
    {
      file: "welcome.htm",
      name: "PAGE_welcome",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
    },
    {
      file: "liveview.htm",
      name: "PAGE_liveview",
      prepend: "=====(",
      append: ")=====",
      method: "plaintext",
      filter: "html-minify",
    },
    {
      file: "favicon.ico",
      name: "favicon",
      method: "binary",
    },
  ],
  "wled00/html_other.h"
);
