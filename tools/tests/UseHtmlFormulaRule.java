import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import io.legado.app.model.analyzeRule.RuleAnalyzer;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;

/** Actual Kotlin rule parser plus actual JS engine; no Android or phone writes. */
public final class UseHtmlFormulaRule {
    private final Object context;
    private final Object scope;
    private final Method evaluate;
    private final Method put;
    private int checks;

    private UseHtmlFormulaRule(String engine) throws Exception {
        Locale.setDefault(Locale.SIMPLIFIED_CHINESE);
        Class<?> cx = Class.forName(engine + ".Context");
        context = cx.getMethod("enter").invoke(null);
        cx.getMethod("setOptimizationLevel", int.class).invoke(context, -1);
        scope = cx.getMethod("initStandardObjects").invoke(context);
        evaluate = compatible(cx, "evaluateString", String.class, String.class, int.class, Object.class);
        put = compatible(Class.forName(engine + ".ScriptableObject"), "putProperty", String.class, Object.class);
    }

    private Method compatible(Class<?> owner, String name, Class<?>... rest) throws Exception {
        for (Method method : owner.getMethods()) {
            Class<?>[] types = method.getParameterTypes();
            if (!method.getName().equals(name) || types.length != rest.length + 1 || !types[0].isInstance(scope)) continue;
            boolean match = true;
            for (int i = 0; i < rest.length; i++) match &= types[i + 1].equals(rest[i]);
            if (match) return method;
        }
        throw new NoSuchMethodException(name);
    }

    private Object eval(String code) {
        try {
            return evaluate.invoke(context, scope, code, "formula-request-rule", 1, null);
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof RuntimeException) throw (RuntimeException) cause;
            throw new RuntimeException(cause);
        } catch (ReflectiveOperationException error) {
            throw new RuntimeException(error);
        }
    }

    private void bind(String key, String value) throws Exception {
        put.invoke(null, scope, key, value);
    }

    private void check(boolean value, String message) {
        checks++;
        if (!value) throw new AssertionError(message);
    }

    private String expand(String rule, List<String> expressions) {
        return new RuleAnalyzer(rule, false).innerRule("{{", "}}", code -> {
            expressions.add(code);
            return String.valueOf(eval(code));
        });
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8);
    }

    private int[] capturedArticle(String capture, String translation, String guard, String wrapper) throws Exception {
        int before = checks;
        bind("__capture", capture);
        check(Boolean.TRUE.equals(eval("JSON.parse(String(__capture)).status === 200 && JSON.parse(String(__capture)).host === 'ieeexplore.ieee.org'")), "successful actual IEEE response required");
        String article = String.valueOf(eval("JSON.parse(String(__capture)).body"));
        Document document = Jsoup.parseBodyFragment(article);
        String snr = null;
        for (org.jsoup.nodes.Element element : document.select("tex-math")) {
            String tex = element.wholeText();
            if (tex.replaceAll("\\s+", "").contains("{{d\\mathrm{snr}")) { snr = tex; break; }
        }
        check(snr != null, "actual 9737357 formula must contain the reported d-mathrm-snr fragment");
        bind("__realFormula", snr);
        // Recreate the request serializer, not a captured phone error stack.
        eval(translation);
        String legacy = String.valueOf(eval("_ltUrl('zh-Hans', [String(__realFormula)])"));
        List<String> attempted = new ArrayList<>();
        RuntimeException failure = null;
        try { expand(legacy, attempted); } catch (RuntimeException error) { failure = error; }
        check(failure != null, "actual article TeX in legacy request must fail rule evaluation");
        check(attempted.size() == 1 && attempted.get(0).replaceAll("\\s+", "").startsWith("d\\"), "actual article's derivative was dispatched as JavaScript");
        check(failure.getMessage().contains("不允许的字符") || failure.getMessage().toLowerCase().contains("illegal character"), "actual article has the same illegal-character error family");
        eval(guard);
        String safe = String.valueOf(eval("_ltUrl('zh-Hans', [String(__realFormula)])"));
        List<String> expressions = new ArrayList<>();
        check(expand(safe, expressions).equals(safe), "actual formula's guarded request stays unchanged");
        check(expressions.isEmpty(), "actual formula must not be dispatched as JavaScript");
        bind("__legacy", legacy); bind("__safe", safe);
        check(Boolean.TRUE.equals(eval("JSON.stringify(JSON.parse(String(__legacy).slice(String(__legacy).indexOf(',')+1))) === JSON.stringify(JSON.parse(String(__safe).slice(String(__safe).indexOf(',')+1)))")), "actual formula's decoded request options stay identical");
        check(Boolean.TRUE.equals(eval("JSON.parse(JSON.parse(String(__safe).slice(String(__safe).indexOf(',')+1)).body)[0] === String(__realFormula)")), "actual formula restores exactly, including whitespace");
        eval(wrapper);
        Document input = Jsoup.parseBodyFragment("<p></p><img>");
        input.outputSettings().prettyPrint(false);
        input.select("p").first().text(snr);
        String image = "https://latex.codecogs.com/svg.latex?" + String.valueOf(eval("encodeURIComponent(String(__realFormula))"));
        input.select("img").first().attr("src", image).attr("alt", snr);
        bind("__html", input.body().html());
        Document output = Jsoup.parse(String.valueOf(eval("useHtmlValidation(String(__html), 'https://ieeexplore.ieee.org/document/9737357/')")));
        check(output.select("p").first().wholeText().equals(snr), "actual formula HTML text is lossless");
        check(output.select("img").first().attr("alt").equals(snr), "actual formula HTML alt is lossless");
        check(output.select("img").first().attr("src").equals(image), "actual formula image URL is not double encoded");
        return new int[] { document.select("tex-math").size(), checks - before };
    }

    private void run(String translation, String guard, String wrapper, String capture) throws Exception {
        eval(translation);
        // Constructed from the owner's error fragment, not downloaded article HTML.
        String formula = "{{d\\mathrm{snr}\n}}";
        bind("__formula", formula);
        String legacy = String.valueOf(eval("_ltUrl('zh-Hans', [String(__formula)])"));
        List<String> attempted = new ArrayList<>();
        RuntimeException legacyError = null;
        try { expand(legacy, attempted); } catch (RuntimeException error) { legacyError = error; }
        check(legacyError != null, "legacy JSON payload must reproduce a JS parse failure");
        check(attempted.size() == 1 && attempted.get(0).startsWith("d\\"), "LaTeX was dispatched as JavaScript");
        check(legacyError.getMessage().contains("不允许的字符") || legacyError.getMessage().toLowerCase().contains("illegal character"), "same illegal-character error family");

        eval(guard);
        String safe = String.valueOf(eval("_ltUrl('zh-Hans', [String(__formula)])"));
        List<String> evaluated = new ArrayList<>();
        check(expand(safe, evaluated).equals(safe), "safe request passes the actual parser unchanged");
        check(evaluated.isEmpty(), "literal formula must never be evaluated as JS");
        bind("__legacy", legacy); bind("__safe", safe);
        check(Boolean.TRUE.equals(eval("JSON.stringify(JSON.parse(String(__legacy).slice(String(__legacy).indexOf(',')+1))) === JSON.stringify(JSON.parse(String(__safe).slice(String(__safe).indexOf(',')+1)))")), "all decoded request options remain identical");
        check(Boolean.TRUE.equals(eval("JSON.parse(JSON.parse(String(__safe).slice(String(__safe).indexOf(',')+1)).body)[0] === String(__formula)")), "request body restores the exact TeX and line break");

        eval(wrapper);
        Document input = Jsoup.parseBodyFragment("<p></p><img>");
        input.outputSettings().prettyPrint(false);
        input.select("p").first().text(formula);
        String imageUrl = "https://latex.codecogs.com/svg.latex?" + String.valueOf(eval("encodeURIComponent(String(__formula))"));
        input.select("img").first().attr("src", imageUrl).attr("alt", formula);
        bind("__html", input.body().html());
        String html = String.valueOf(eval("useHtmlValidation(String(__html), 'https://ieeexplore.ieee.org/document/9737357/')"));
        Document output = Jsoup.parse(html);
        check(html.startsWith("<usehtml>") && html.endsWith("</usehtml>"), "wrapper retained");
        check(output.select("p").first().wholeText().equals(formula), "HTML text keeps raw LaTeX losslessly");
        check(output.select("img").first().attr("alt").equals(formula), "HTML alt keeps raw LaTeX losslessly");
        check(output.select("img").first().attr("src").equals(imageUrl), "Codecogs percent encoding is not double escaped");
        int[] actual = capture == null ? null : capturedArticle(capture, translation, guard, wrapper);
        String articleReport = actual == null ? "" : ",\"article\":{\"kind\":\"captured-IEEE-9737357-formula\",\"texMathElements\":" + actual[0] + ",\"checks\":" + actual[1] + ",\"status\":\"PASS\",\"phonePipelineVerified\":false}";
        System.out.println("{\"status\":\"PASS\",\"checks\":" + checks + ",\"legacyError\":\"illegal-character\",\"parser\":\"actual-Kotlin-RuleAnalyzer\",\"kind\":\"constructed-owner-fragment\"" + articleReport + "}");
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 4 && args.length != 5) throw new IllegalArgumentException("translation-runtime guard wrapper engine-package [actual-IEEE-capture]");
        new UseHtmlFormulaRule(args[3]).run(read(args[0]), read(args[1]), read(args[2]), args.length == 5 ? read(args[4]) : null);
    }
}
