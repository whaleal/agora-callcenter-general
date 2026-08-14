"""
Generate a structured Voice Agent interviewer script from a questionnaire.

Input:  PDF bytes (preferred) or plain questionnaire text (DOCX fallback)
Output: Streaming JSON text — a JSON object with fixed English section keys.
        After streaming completes, use `parse_sections_json` to extract sections
        and `assemble_prompt_from_sections` to build the full system prompt text.

Design goals:
- The JSON keys are stable and language-agnostic (English identifiers).
- All text inside JSON values follows the requested language (zh/ko/en/ja).
"""
from __future__ import annotations

import base64
import json
from typing import AsyncIterator

from app.core.config import settings
from app.core.llm import make_async_anthropic_client

# Fixed section key order — assembly preserves this order, null values are skipped.
# 'greeting' is intentionally excluded: it is a separate Voice Agent configuration field,
# NOT part of the assembled system prompt text.
PROMPT_SECTION_KEYS = [
    'core_guidelines',
    'randomization_rules',
    'global_execution_logic',
    'question_sop',
    'interview_script',
    'closing_remarks',
    'data_mapping',
]

# greeting and failure_message are stored in sections JSON but never merged into the system prompt
GREETING_KEY = 'greeting'
FAILURE_MESSAGE_KEY = 'failure_message'

_SYSTEM_PROMPT = """\
You are an expert author of telephone survey scripts for an AI voice agent.
Analyze the provided questionnaire and output ONLY a valid JSON object with the exact keys below.
Do NOT output markdown code fences, explanations, or any extra text. Output pure JSON only.

Output JSON format (keep the key names and the key order EXACTLY):
{
  "greeting":       "(오프닝 첫 발화 텍스트 — 통화 연결 즉시 AI가 말하는 순수 텍스트. 마크다운 없이 구어체 한 문단)",
  "failure_message": "(AI가 응답을 인식하지 못했을 때 재시도 요청 문구. 예: '죄송합니다, 잘 못 들었어요. 다시 한 번 말씀해 주시겠어요?' — 순수 구어체 텍스트, 마크다운 없이)",
  "core_guidelines":       "# [Core Guidelines]\\n(content)",
  "randomization_rules":   "# [Randomization Rules]\\n(content)" or null,
  "global_execution_logic": "# [Global Execution Logic]\\n(content)",
  "question_sop":          "# [Question-specific SOP]\\n(content)",
  "interview_script":      "# [Interview Script]\\n(content)",
  "closing_remarks":       "# [Closing Remarks]\\n(content)",
  "data_mapping":          "# [Data Mapping & Recording Rules]\\n(content)"
}

Important:
- greeting: the voice agent's greeting field. Only the first utterance after the call connects.
  Must begin with the required phrase for the chosen language (see language requirement below).
  Plain conversational text only (no markdown, no headings).
- failure_message: what the agent says when ASR fails. One short natural sentence.
- Sections: include BOTH a section title header line and the section body.
- randomization_rules: use null if there are no questions requiring randomized answer options.

---

각 섹션 작성 지침:

【핵심 지침】
- 역할: 전문 여론조사 면접원 AI. AI가 전화를 걸어 조사를 진행함.
- 스크립트를 한 글자도 빠짐없이 준수. 임의 수정·축소·추가 엄격 금지.
- 조사 목적과 소요 시간(약 3~5분) 사전 안내 필수.
- **[선택지 번호 통일]** ①②③ / ⑴⑵⑶ 등 원문자 일체를 아라비아 숫자(1. 2. 3.)로 변환. 원문 기호 그대로 사용 금지.
- **[AI 신원 고지 의무]** 오프닝 첫 문장에 반드시 "저는 AI 면접원입니다" 포함. 사람 면접원으로 오해받는 표현 금지.
- **[성별 처리 원칙]** 성별 항목이 "조사원 판단"인 경우 응답자에게 직접 성별 질문 필요. 해당 조건 없으면 성별 질문 생성 금지.

【무작위 순서 강제 규칙】(선택지 목록 질문이 있을 때만)
- 무작위 셔플 필요 질문 번호 명시 (예: Q3, Q5)
- 동일 질문 추가 확인 시 최초 셔플 순서 그대로 유지
- 셔플 대상 아닌 질문(만족도 척도, 인구통계)은 설문지 순서 그대로

【전역 실행 로직】
## 1. 참여 의향 확인
- 통화 연결 직후 실행
- 긍정 → 다음 단계 / 부정·거부 → 【강제 종료】 / 불명확 → 1회 재확인 후 부정이면 종료

## 2. SQ 처리
- 설문지에 명시된 모든 전치 자격 확인 질문
- 조건 불충족 → 【조건 불충족 종료】

## 3. 본 조사 구간
- ASR 오류 → "잘 못 들었어요, 다시 한 번 말씀해 주시겠어요?" 후 무응답(9)
- 명확한 거부 → 【강제 종료】

## 4. 범용 ASR 오류 허용 판정 알고리즘
- 1회 불일치: "혹시 [가장 유사한 선택지]라고 하셨나요?" 재확인
- 재확인 후에도 불일치: 가장 유사한 선택지로 강제 판정

## 5. 성별 확인 처리 (성별 항목이 "조사원 판단"인 경우에만 포함)
- 적용 시점: 오프닝 직후, SQ 진입 전
- 예시: "실례지만, 선생님의 성별을 여쭤봐도 될까요? 남성이신가요, 여성이신가요?"
- 거부 시 무응답(9) 기록 후 SQ 진행 (종료 아님)

## 6. 전환 피드백 규칙
- SQ 응답 후: "네, 알겠습니다."
- 본 조사 각 질문 응답 후: "네, 감사합니다." 후 즉시 다음 질문

【질문별 추가 질문 SOP】
- 선택지 목록 질문: 모호한 답변 → 전체 선택지 재낭독
- 정당·후보 관련: 정당명만 응답 → 해당 정당 후보 필터링 재질문
- 투표 의향: "아직 결정 못 했어요" → "지금 현재 어느 분께 좀 더 마음이 가세요?" 1회 추가
- 만족도 척도: "만족" → "매우 만족이세요, 아니면 그냥 만족이세요?" 분류 확인
- 인구통계: 거부 시 "통계 가중치 산출에 꼭 필요한 항목입니다. 대략적으로라도 말씀해 주시겠어요?" 1회 재요청
- 거주지·지역: 유사음 허용 비교; 추가 확인 후에도 불명확 시 ASR 원문 그대로 기록

【정식 면접 스크립트】
설문지 순서에 따라 작성:
[오프닝] 인사 + 조사 기관 소개 + 목적 안내 + 소요 시간 + 참여 의향 확인
[SQ 구간] 각 SQ 구어체 + 분기 명시 (충족→계속 / 불충족→【조건 불충족 종료】)
[본 조사 구간] 자연스러운 구어체 경어(합쇼체), [선택지1 / 선택지2] 형식, skip 조건 명시

【종료 멘트】
1. 【조건 불충족 종료】— SQ 조건 미충족
2. 【강제 종료】— 명확 거부·중도 포기
3. 【정상 완료 종료】— 모든 질문 완료

【데이터 매핑 및 기록 규칙】
※ 백엔드 전용. 응답자에게 절대 읽어주지 말 것.

변수명 및 답변 코드 매핑표 (모든 SQ/Q/DQ 빠짐없이):
| 변수명 | 질문 내용 요약 | 답변 코드 |

변수명 규칙:
- 설문지에 명시된 변수명 우선 사용
- 없는 경우: SQ1/SQ2... / Q1/Q2... / DQ1/DQ2...
- 무응답/모름=9 (코드 10개 이상이면 99), skip=null, 개방형=ASR 원문(OPEN)

지역·지명 표준화 (지역 관련 질문이 있는 경우):
ASR 인식 지명 ↔ 표준 행정구역명 매핑

통화 결과 코드:
0=조사성공|1=결번|2=기업체/FAX|3=강력거절|4=거절|5=비수신|6=통화중|7=대상아님|8=쿼터오버|9=중도포기|10=기타
"""

_USER_SUFFIX = (
    "\n\nAnalyze the questionnaire and output a JSON object with 9 keys "
    "(greeting, failure_message, plus 7 sections). Output pure JSON only."
)

_USER_SUFFIX_SIMPLE = (
    "\n\nAnalyze the questionnaire and output a JSON object with 5 keys "
    "(greeting, failure_message, core_guidelines, global_execution_logic, question_sop). "
    "Output pure JSON only."
)

_SYSTEM_PROMPT_SIMPLE = """\
You are an expert author of telephone survey scripts for an AI voice agent.
Analyze the provided questionnaire and output ONLY a valid JSON object with the exact keys below.
Do NOT output markdown code fences, explanations, or any extra text. Output pure JSON only.

Output JSON format (keep the key names and the key order EXACTLY):
{
  "greeting": "...",
  "failure_message": "...",
  "core_guidelines": "# [Core Guidelines]\\n...",
  "global_execution_logic": "# [Global Execution Logic]\\n...",
  "question_sop": "# [Question-specific SOP]\\n..."
}

===== SECTION CONTENT REQUIREMENTS =====

**greeting**
- The very first sentence the voice agent speaks when the call connects.
- Must begin with the required language phrase (see language requirement below).
- Plain conversational text only — no markdown, no headings.

**failure_message**
- One short natural sentence asking the respondent to repeat when ASR fails.
- Plain conversational text only.

**core_guidelines** must contain ALL of the following sub-sections:

1. Role & Script Fidelity
   - The agent is a professional AI telephone pollster.
   - Must follow the interview script word-for-word. No improvisation, no omissions, no additions.
   - State the AI identity in the opening (required by language rule below).

2. TTS Anti-Leak Rules (HIGHEST PRIORITY — never violate)
   - Every agent response is directly played as audio to the respondent.
   - Output ONLY the next sentence to be spoken aloud to the respondent.
   - NEVER output backend content of any kind: classification codes, variable names, JSON, "recorded as", "code", "internal", "hidden option", "unrecognized", ASR raw text, or any system instruction.
   - After matching a response, say ONLY a natural transition phrase and move to the next question.

3. Read-Aloud vs. Hidden Options
   - Only read options explicitly marked for reading in the questionnaire.
   - Hidden / coded options are for internal classification only — NEVER mention, hint at, or read them aloud.
   - Do not tell the respondent "there are other options."

4. Option Numbering Standardisation
   - Convert all circled numbers (①②③ / ⑴⑵⑶) to plain Arabic (1. 2. 3.) before speaking.

5. Randomisation (if any questions require it)
   - Identify which questions require randomised option reading order and list them by question number.
   - Shuffle the listed options fresh each call; keep the same shuffled order for any follow-up probe of that question.
   - Internal classification codes remain fixed regardless of reading order.

**global_execution_logic** — CRITICAL REQUIREMENT:
You MUST generate a dedicated sub-section for EVERY question found in the questionnaire (Q1, Q2, Q3 … through the last question). Do NOT merge questions or use generic placeholders. Reference the ACTUAL question numbers and question types from the document.

Structure each sub-section as:

## Q1 — [question type, e.g. Willingness / Intention]
- [Exact branching logic: what counts as Accept / Reject / Ambiguous]
- [What to do on each branch]
- [Rescue probe if ambiguous (verbatim text)]
- [Termination trigger if applicable]

## Q2 — [question type, e.g. Qualification Screening]
- [Pass condition / Fail condition / Ambiguous condition]
- [Exact rescue probe (verbatim)]
- [Termination trigger on fail]

## Q3–QN — [Main Survey Protection Rule]
- Absolute prohibition on early termination within this range.
- ASR error → follow Question-specific SOP for that question; then proceed.
- Explicit refusal mid-survey → proceed to next question (do not terminate).

## Universal ASR Tolerance Algorithm (applies to all questions)
- Full candidate/option list monitoring: never ignore an option because a different option is being probed.
- Phonetic matching: use pronunciation, similar sounds, and vowel patterns — not only exact characters.
- Single confirmation: if a match is suspected, confirm once: "您是指 [correct full name/option] 嗎？"
- If the respondent repeats the same phonetically similar answer twice, stop probing; apply forced internal classification; say only a transition phrase.

## Transition & Confidentiality (applies to all questions)
- Alternate between natural transition phrases (e.g. "謝謝您"、"好的，謝謝") between questions.
- NEVER reveal how a response was classified, repeat a code, or say any backend instruction.

**question_sop** — CRITICAL REQUIREMENT:
You MUST generate a dedicated sub-section for EVERY question found in the questionnaire. Do NOT merge questions or use generic templates. Each sub-section must contain the actual question-specific logic derived from the questionnaire content.

For each question, follow the rule set that matches its type:

▸ Candidate / Person-Choice Questions
  - Named-candidate matching: full name, nickname, phonetically similar sounds → internal classification only; never report the code to the respondent.
  - Hidden-code responses (e.g. "don't support anyone", "other person", "don't know candidates", "refuse"): specify exact trigger phrases and their internal codes.
  - "Undecided / don't know / still considering" → one fixed follow-up probe (verbatim); if still ambiguous after probe → internal code for undecided.
  - Party-narrowing rule: if respondent names a party without naming a candidate → read only that party's candidates and ask which one; do NOT re-read the full list.
  - Cross-party detection: even while in a party-narrowing probe, if respondent's speech matches any other party's candidate, immediately classify as that candidate; say only a transition phrase.

▸ Voting Intention / Likelihood Questions
  - Map each response variant to its internal code (e.g. "definitely will" → 01, "probably will" → 02, "won't" → 03).
  - For clear answers (codes 01/02/03): NO follow-up — move immediately to next question.
  - For ambiguous answers (e.g. "depends", "not sure"): one fixed follow-up probe (verbatim); if still ambiguous → internal undecided code.

▸ Age / Open-Ended Numeric Questions
  - Accept exact age or approximate range (e.g. "around 40s").
  - Maximum 1 retry with verbatim retry phrase if not heard clearly.
  - If still unclear or refused after retry → record as refuse/unknown code; proceed.

▸ Education / Scale Questions (Relaxed — No Follow-up Allowed)
  - Map response to fixed code immediately.
  - If unrecognisable or refused → internal "unknown/refuse" code.
  - ABSOLUTELY NO follow-up probe for this question type.

▸ Region / District Questions (Relaxed — No Follow-up Allowed)
  - NEVER read out the full district list.
  - Match response phonetically to the district list in the background.
  - If match is uncertain → record ASR raw text internally; proceed to next question.
  - NEVER say "pending review", "unrecognised", or the ASR raw text to the respondent.

▸ Party Preference Questions (Relaxed)
  - Apply randomisation rule (same shuffled order as first reading if probe needed).
  - Internal codes are always fixed regardless of reading order.
  - Map all ambiguous or off-list responses to their fixed internal codes (e.g. other party, neutral, refuses, don't know).
  - NO follow-up probe; do NOT report classification to respondent.

▸ Gender Questions (Relaxed)
  - Male → internal code 01; Female → internal code 02; Refuse → internal code 95.
  - Any unclassifiable answer → record ASR raw text internally; proceed to closing.
  - NO follow-up probe; do NOT report classification to respondent.

===== IMPORTANT RULES FOR ALL SECTIONS =====
1. ALL 5 keys must be present in the output. Do not omit any key.
2. Keep all JSON key names unchanged (English); translate only the VALUES to the target language.
3. Each section value must start with its title header line.
4. The global_execution_logic and question_sop sections MUST enumerate EVERY question in the questionnaire individually — failure to do so is incorrect output.
5. Use the actual question numbers, candidate names, party names, district names, and option texts extracted from the questionnaire — do NOT use placeholders like "[candidate name]" or "[option]".
"""

# Language instructions injected at the end of the system prompt.
# Includes explicit section-title translations so the AI uses the correct language
# for headers inside each section value (e.g. "# 【핵심 지침】" → "# 【核心指导原则】").
_LANGUAGE_INSTRUCTIONS: dict[str, str] = {
    'ko': (
        '\n\n[Language Requirement]\n'
        'Write ALL JSON values in Korean.\n'
        'greeting must begin with "저는 AI 면접원입니다".\n'
        'failure_message must be Korean.\n'
        'Translate section title headers inside each section value to Korean.\n'
    ),
    'zh': (
        '\n\n【语言要求】\n'
        '请将JSON中所有文本内容（greeting、failure_message及所有section的值）用中文（简体）书写。\n'
        'JSON的键名保持英文不变，只翻译/改写值的内容。\n'
        'greeting必须用中文，开头必须包含"我是AI访问员"。\n'
        'failure_message必须用中文，示例："对不起，我没有听清楚，请您再说一遍好吗？"\n'
        '各section值内的标题头部也需翻译为中文，例如：\n'
        '- core_guidelines → # 【核心指导原则】\n'
        '- randomization_rules → # 【随机顺序强制规则】\n'
        '- global_execution_logic → # 【全局执行逻辑】\n'
        '- question_sop → # 【各题追问SOP】\n'
        '- interview_script → # 【正式访问脚本】\n'
        '- closing_remarks → # 【结束语】\n'
        '- data_mapping → # 【数据映射及记录规则】\n'
        '注意：任何位置都不要出现韩文。'
    ),
    'en': (
        '\n\n[Language Requirement]\n'
        'Write all text content inside the JSON values (greeting, failure_message, and all sections) in English.\n'
        'Keep the JSON key names unchanged; only the content values should be in English.\n'
        'The greeting must begin with "I am an AI interviewer".\n'
        'The failure_message must be in English, e.g.: "I\'m sorry, I didn\'t catch that. Could you please repeat?"\n'
        'Translate section title headers inside each section value to English and avoid non-English words.\n'
    ),
    'ja': (
        '\n\n【言語要件】\n'
        'JSON内のすべてのテキスト（greeting、failure_message、すべてのsectionの値）を日本語で記述してください。\n'
        'JSONのキー名はそのまま維持し、値の内容のみ日本語にしてください。\n'
        'greetingは「私はAIインタビュアーです」で始めてください。\n'
        'failure_messageは日本語で記述してください。例：「申し訳ありません、聞き取れませんでした。もう一度おっしゃっていただけますか？」\n'
        '各sectionの値内のタイトルも日本語に翻訳してください（例：# 【コアガイドライン】など）。\n'
        '注意：どの位置にも韓国語を含めないでください。'
    ),
}

_SCHEMA_EXTRACT_PROMPT = """\
Analyze the Voice Agent Prompt section that defines data mapping / recording rules (e.g. "Data Mapping & Recording Rules").
Extract a Structured Output variable schema for the voice agent platform and output ONLY valid JSON.
Do NOT output explanations or markdown code fences.

출력 형식:
{
  "call_success": {"type": "boolean", "description": "조사 성공 여부", "codes": {}},
  "변수명": {"type": "integer|null", "description": "질문 내용 요약", "codes": {"1": "선택지1", "2": "선택지2", "9": "무응답"}}
}

규칙:
- call_success는 항상 포함 (boolean 타입)
- SQ 변수: type = "integer|null"
- 참여 의향처럼 예/아니오인 변수: type = "boolean|null"
- 일반 선택형 질문: type = "integer|null", codes에 모든 코드 포함
- 인구통계 연령처럼 숫자 직접 입력: type = "integer|null", codes = {}
- 개방형 질문: type = "string|null", codes = {}
- 건너뛴 질문의 기본값은 null

Voice Agent Prompt:
"""


def assemble_prompt_from_sections(sections: dict) -> str:
    """
    Assemble full prompt text from a sections dict (as returned by AI).
    Skips null/empty values, joins with --- separators.
    """
    parts = []
    for key in PROMPT_SECTION_KEYS:
        val = sections.get(key)
        if val and val.strip():
            parts.append(val.strip())
    return '\n\n---\n\n'.join(parts)


def parse_sections_json(raw_text: str) -> dict | None:
    """
    Parse the raw streamed JSON text into a sections dict.
    Returns None if parsing fails.
    """
    text = raw_text.strip()
    # Strip markdown code fences if present
    if text.startswith('```'):
        text = text.split('\n', 1)[1].rsplit('```', 1)[0].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


async def extract_structured_output_schema(prompt_text: str) -> dict:
    """
    Extract the Structured Output variable schema from the generated Voice Agent Prompt.
    Returns a dict mapping variable names to their type/description/codes definitions.
    """
    client = make_async_anthropic_client()
    resp = await client.messages.create(
        model=settings.anthropic_model,
        max_tokens=2048,
        messages=[{
            'role': 'user',
            'content': _SCHEMA_EXTRACT_PROMPT + prompt_text,
        }],
    )
    raw = resp.content[0].text.strip()
    if raw.startswith('```'):
        raw = raw.split('\n', 1)[1].rsplit('```', 1)[0].strip()
    return json.loads(raw)


async def generate_voice_prompt_stream(
    file_data: bytes | None,
    file_type: str | None,
    questionnaire_raw: str | None,
    language: str = 'ko',
    simplified: bool = False,
) -> AsyncIterator[str]:
    """
    Stream the JSON object representing the Voice Agent prompt sections.

    Priority:
      1. PDF → pass as document directly to Claude (best quality)
      2. DOCX/text → pass questionnaire_raw as text (fallback)

    Caller should accumulate all chunks, then call parse_sections_json()
    and assemble_prompt_from_sections() to get the full prompt text.
    """
    client = make_async_anthropic_client()
    lang_instruction = _LANGUAGE_INSTRUCTIONS.get(language, '')
    base_prompt = _SYSTEM_PROMPT_SIMPLE if simplified else _SYSTEM_PROMPT
    system_prompt = base_prompt + lang_instruction
    user_suffix = _USER_SUFFIX_SIMPLE if simplified else _USER_SUFFIX

    if file_data and file_type == 'pdf':
        b64 = base64.standard_b64encode(file_data).decode()
        content = [
            {
                'type': 'document',
                'source': {
                    'type': 'base64',
                    'media_type': 'application/pdf',
                    'data': b64,
                },
            },
            {'type': 'text', 'text': user_suffix},
        ]
    else:
        text = questionnaire_raw or '(설문지 내용 없음)'
        content = [{'type': 'text', 'text': text + user_suffix}]

    async with client.messages.stream(
        model=settings.anthropic_model,
        max_tokens=64000,
        system=system_prompt,
        messages=[{'role': 'user', 'content': content}],
    ) as stream:
        async for chunk in stream.text_stream:
            yield chunk
