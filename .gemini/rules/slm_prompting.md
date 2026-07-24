# SLM Prompt Engineering for Context & Acronyms

When generating prompts for Small Language Models (SLMs like `llama3 8B`, `gemma2`, `phi3`) to map entities or expand acronyms:

1. **Avoid Prose:** Do not use descriptive paragraphs for context. SLMs suffer from attention dilution.
2. **Use Structured Mapping:** Always format context dictionaries as bulleted key-value lists (e.g., `- "KEY" = Value`).
3. **Quote the Keys:** Wrap acronyms/keys in quotes (e.g., `"NHSL"`). This forces the LLM's attention mechanism to treat it as a strict string-matching variable.
4. **Remove Domain Bias:** Do not include specific participant/entity names in the high-level `DOMAIN` description if there are multiple entities. The LLM will heavily bias toward the one mentioned in the domain and ignore the acronym dictionary. Keep the domain description neutral.
5. **No Spaces in Keys:** Ensure acronym keys do not have spaces (e.g., use `"HIS"` rather than `"NHS HIS"`).
