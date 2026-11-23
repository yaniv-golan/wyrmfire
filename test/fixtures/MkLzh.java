import jp.gr.java_conf.dangan.util.lha.*;
import java.io.*;
import java.nio.file.*;
// java MkLzh out.lzh method level name=file [name=file...]
public class MkLzh {
  public static void main(String[] a) throws Exception {
    LhaOutputStream out = new LhaOutputStream(new FileOutputStream(a[0]));
    for (int i = 3; i < a.length; i++) {
      String[] nf = a[i].split("=", 2);
      byte[] data = Files.readAllBytes(Paths.get(nf[1]));
      LhaHeader h = new LhaHeader(nf[0]);
      h.setCompressMethod(a[1]);
      h.setHeaderLevel(Integer.parseInt(a[2]));
      h.setOriginalSize(data.length);
      out.putNextEntry(h); out.write(data); out.closeEntry();
    }
    out.close();
  }
}
