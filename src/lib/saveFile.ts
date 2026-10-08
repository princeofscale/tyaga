/** Hands a text file to the user: a download on the web, the share sheet on Android. */
export async function saveFile(name: string, text: string, type = "application/json") {
  if (import.meta.env.MODE === "device") {
    // A WebView cannot download blob: links, so write a real file and share it.
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const { uri } = await Filesystem.writeFile({
      path: name,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title: name, files: [uri] }).catch(() => undefined); // closed sheet
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
