"""AI analyst prompt-guardrail tests (no live Anthropic calls, no DB).

Covers the fix for "the analyst silently substituted Almaty with the
'Алматинский' district of Astana and answered as if the question was about
Almaty". Two things must hold going forward:

1. The SQL-generation system prompt must keep telling the model the database
   covers only Astana and must not substitute a similarly-named entity.
2. The summarizer must be grounded in the *actual executed SQL* (so it can
   name the real filter value, e.g. "район «Алматинский»") instead of just
   parroting the user's original wording, and must be told to say "данных
   нет" when the result does not actually answer the question.

These are prompt-content regression tests: they don't call the real API (no
ANTHROPIC_API_KEY needed), they capture what `generate_sql`/`summarize` send
to `client.messages.create` and assert the guardrail text/data is present.
"""

from types import SimpleNamespace

from app.chat import SCHEMA_DOC, generate_sql, summarize


class _FakeMessages:
    """Duck-types `anthropic.Anthropic().messages` — records kwargs, returns canned content."""

    def __init__(self, calls: list[dict], content: list):
        self._calls = calls
        self._content = content

    def create(self, **kwargs):
        self._calls.append(kwargs)
        return SimpleNamespace(content=self._content)


class _FakeClient:
    def __init__(self, content: list):
        self.calls: list[dict] = []
        self.messages = _FakeMessages(self.calls, content)


def _tool_use(sql: str, intent: str):
    return SimpleNamespace(type="tool_use", input={"sql": sql, "intent": intent})


def _text(t: str):
    return SimpleNamespace(type="text", text=t)


# --- generate_sql: system prompt must forbid silent entity substitution ------


def test_schema_doc_declares_astana_only_coverage():
    assert "Астана" in SCHEMA_DOC
    assert "Алматы" in SCHEMA_DOC  # explicit district-vs-city disambiguation example


def test_generate_sql_system_prompt_forbids_similar_name_substitution():
    client = _FakeClient([_tool_use("SELECT 1", "test")])
    generate_sql(client, "Сколько объектов высокого риска в Алматы?")
    system = client.calls[0]["system"]
    assert "Астана" in system
    assert "подменяй" in system or "подставляй" in system


def test_generate_sql_sends_question_verbatim_as_user_message():
    client = _FakeClient([_tool_use("SELECT 1", "test")])
    generate_sql(client, "Сколько объектов высокого риска в Алматы?")
    assert client.calls[0]["messages"] == [
        {"role": "user", "content": "Сколько объектов высокого риска в Алматы?"}
    ]


# --- summarize: must be grounded in the actual SQL, not the question -------


def test_summarize_passes_actual_sql_to_the_model():
    client = _FakeClient([_text("В районе «Алматинский» — 17 объектов.")])
    sql = (
        "SELECT b.id FROM buildings b JOIN risk_scores r ON r.building_id = b.id "
        "WHERE b.district ILIKE '%Алматинский%' AND r.score >= 40 LIMIT 50"
    )
    summarize(client, "Сколько объектов высокого риска в Алматы?", sql, ["id"], [[1]])
    user_content = client.calls[0]["messages"][0]["content"]
    assert sql in user_content


def test_summarize_system_prompt_requires_grounding_in_real_filter_value():
    client = _FakeClient([_text("ok")])
    summarize(client, "вопрос", "SELECT 1", [], [])
    system = client.calls[0]["system"]
    # Must instruct the model to name the real filter value, not echo the
    # user's wording, and to say "данных нет" when the result is empty.
    assert "данных нет" in system
    assert "Алматинский" in system  # concrete worked example kept in the prompt
    assert "Астан" in system  # "Астану"/"Астана" — city-coverage reminder


def test_summarize_still_reports_row_count_and_preview():
    client = _FakeClient([_text("ok")])
    summarize(client, "вопрос", "SELECT 1", ["id", "score"], [[1, 42]])
    user_content = client.calls[0]["messages"][0]["content"]
    assert "Найдено строк: 1" in user_content
    assert "42" in user_content
