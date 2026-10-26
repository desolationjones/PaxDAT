// Apply "address<TAB>name" lines from a TSV to functions (creating them if needed).
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;
import java.nio.file.*;

public class ApplyNames extends GhidraScript {
    @Override
    public void run() throws Exception {
        int n = 0;
        for (String line : Files.readAllLines(Paths.get(getScriptArgs()[0]))) {
            line = line.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] p = line.split("\t");
            Address a = toAddr(Long.parseLong(p[0].replace("0x", ""), 16));
            Function f = getFunctionAt(a);
            if (f == null) f = createFunction(a, null);
            if (f == null) { println("no function at " + a); continue; }
            f.setName(p[1], SourceType.USER_DEFINED);
            if (p.length > 2) f.setComment(p[2]);
            n++;
        }
        println("names applied: " + n);
    }
}
