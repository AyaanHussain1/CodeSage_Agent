from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi,TranscriptsDisabled
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import ChatOpenAI,OpenAIEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import PromptTemplate
from deep_translator import GoogleTranslator
from youtube_transcript_api._errors import NoTranscriptFound
import time
import json
import os
# Necessary details before this project
load_dotenv(override=True)
model = ChatOpenAI()
embedding = OpenAIEmbeddings()
video_id = "ukzFI9rgwfU"

# making directory — resolved relative to THIS FILE's location so it stays
# consistent no matter which folder you launch the server from.
cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "transcript_cache")
os.makedirs(cache_dir,exist_ok=True)

# Codes deep_translator's GoogleTranslator does NOT support with a region suffix.
# YouTube often returns regional variants like "en-CA", "en-US", "pt-BR", "es-419" —
# deep_translator only knows the base code ("en", "pt", "es"), except for Chinese,
# which it expects in full ("zh-CN" / "zh-TW"), so that one is left untouched.
def _normalize_language_code(code):
    if code.lower() in ("zh-cn", "zh-tw"):
        return code
    return code.split("-")[0]


def _cache_path(video_id, to_translate):
    return os.path.join(cache_dir, f"{video_id}_{to_translate}.json")

def language_translation_transcript(video_id, to_translate="en",force_refresh=False):
    """
    Step 1 - Indexing - transcript retrieve - using google translator
    Automatically detects whatever transcript language is available on the video
    and translates it into target language (default: English). Retrieves + 
    translates a transcript, caching results to disk so repeated
    calls (or single-chunk access) don't require re-translating everything.
    """

    cache_file = _cache_path(video_id, to_translate)

    if os.path.exists(cache_file) and not force_refresh:
        # print(f"Loading cached transcript from {cache_file}")
        with open(cache_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data["chunks"]

    try:
        yt_api = YouTubeTranscriptApi()
        transcript_list = yt_api.list(video_id)

        try:
            available = list(transcript_list)
            if not available:
                return "No transcript found for this video"
            transcript = available[0]
        except NoTranscriptFound:
            return "No transcript found for this video"

        detected_language = _normalize_language_code(transcript.language_code)
        # print(f"Detected transcript language: {detected_language}")

        text = " ".join([chunk["text"] for chunk in transcript.fetch().to_raw_data()])
        if not text:
            return "No text found in transcript"

        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000, chunk_overlap=300, separators=["\n\n", "\n", ".", " ", ""]
        )
        chunks = text_splitter.split_text(text)
        chunks_list = []

        # If the video is already in the target language, skip translation entirely —
        # no point burning API calls (and 3s of sleep per chunk) translating en -> en.
        if detected_language == to_translate:
            chunks_list = chunks
        else:
            translator = GoogleTranslator(source=detected_language, target=to_translate)
            for i, chunk in enumerate(chunks, 1):
                print(f"Translating chunk {i} | {len(chunk)}")
                try:
                    chunks_list.append(translator.translate(chunk))
                    time.sleep(3)
                except Exception as e:
                    print(f"Error translating chunk {i}: {e}")
                    chunks_list.append(chunk)

        # Save to the SAME file the cache-check reads from
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "video_id": video_id,
                    "detected_language": detected_language,
                    "target_language": to_translate,
                    "chunks": chunks_list,
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
        print(f"Cached to {cache_file}")

        return chunks_list

    except NoTranscriptFound:
        return "No transcript found for this video"
    except Exception as e:
        return f"Error: {e}"


def get_chunk(video_id, chunk_index, to_translate="en"):
    """
    Access a single chunk by index without re-translating everything.
    Uses cache if available; runs the full pipeline once if not cached yet.
    """
    chunks = language_translation_transcript(video_id, to_translate)
    if isinstance(chunks, str):  # error message case - false condition 
        return chunks
    if chunk_index < 0 or chunk_index >= len(chunks):
        return f"Chunk index out of range (0 to {len(chunks)-1})" # -1 for telling user that index starts from 0
    return chunks[chunk_index]

# This block only runs when you execute this file directly (translation_and_chunking.py),
# NOT when another file does `from translation_and_chunking import ...`.
# Without this guard, the server would re-run this test code every time it imports this file.
if __name__ == "__main__":
    chunks = language_translation_transcript(video_id, "en")
    chunk_3 = get_chunk(video_id, 3, "en")
    # print(chunk_3)

   


     
    