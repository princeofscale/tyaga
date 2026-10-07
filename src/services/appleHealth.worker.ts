import { Unzip, UnzipInflate } from "fflate";
import { AppleHealthImport } from "../domain/AppleHealthImport";
self.onmessage = async (event: MessageEvent<{file:File; date:string; timeZone:string}>) => {
  try {
    const { file, date, timeZone } = event.data;
    const compressed = file.name.toLowerCase().endsWith(".zip");
    if (file.size > (compressed ? 250 : 1024) * 1024 * 1024) throw new Error(compressed ? "ZIP больше 250 МБ. Извлеки export.xml из архива и выбери его." : "XML больше 1 ГБ. Нужен экспорт с меньшим объёмом данных.");
    const parser = new AppleHealthImport(date,timeZone), decoder = new TextDecoder();
    const reader = file.stream().getReader(); let read = 0, found = false, completed = false;
    const unzip = compressed ? new Unzip(entry => {
      if (!/(^|\/)export\.xml$/i.test(entry.name) || found) return;
      found = true;
      if ((entry.originalSize ?? 0) > 1024 * 1024 * 1024) throw new Error("XML внутри архива больше 1 ГБ");
      entry.ondata = (error,data,final) => {
        if (error) throw error;
        parser.write(decoder.decode(data,{stream:!final}));
        if (final) completed = true;
      };
      entry.start();
    }) : null;
    unzip?.register(UnzipInflate);
    while(true) {
      const {done,value} = await reader.read(); if(done) break;
      read += value.length;
      if (unzip) unzip.push(value,false); else parser.write(decoder.decode(value,{stream:true}));
      self.postMessage({ progress:Math.round(read/file.size*100) });
    }
    if (unzip) { unzip.push(new Uint8Array(),true); if (!found || !completed) throw new Error("В ZIP нет полного export.xml приложения Apple Health"); }
    else parser.write(decoder.decode());
    self.postMessage({ candidates:parser.finish() });
  } catch(e) { self.postMessage({ error:e instanceof Error ? e.message : "Не удалось прочитать экспорт" }); }
};
