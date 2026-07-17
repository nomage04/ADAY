(function initDownload(global) {
  "use strict";
  const PPTGen = global.PPTGen = global.PPTGen || {};
  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  PPTGen.download = { saveBlob };
})(window);

