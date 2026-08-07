from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings,ChatOpenAI
from langchain_community.vectorstores import FAISS
from translation_and_chunking import language_translation_transcript
import json
import os
from langchain_classic.retrievers import ContextualCompressionRetriever  
from langchain_classic.retrievers.document_compressors import LLMChainExtractor

embedding = OpenAIEmbeddings()
video_id = "ukzFI9rgwfU"

# Always resolve this folder relative to THIS FILE's location, not wherever
# the process happens to be launched from (e.g. backend/) — this is what was
# causing duplicate Embedding_vector_store folders to appear in backend/.
embedding_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Embedding_vector_store")
os.makedirs(embedding_dir, exist_ok=True)

def get_vector_store(video_id, to_translate="en", force_refresh=False):
    """
    Step 2 - Indexing - embedding generation & storage
    Converts cached transcript chunks into a FAISS vector store.
    Saves the index locally so repeated calls don't re-embed
    (and re-charge OpenAI) for the same video.
    """

    index_path = os.path.join(embedding_dir, f"{video_id}_{to_translate}_faiss")

    if os.path.exists(index_path) and not force_refresh:
        # print(f"Loading cached Vector store from {index_path}")
        vector_store = FAISS.load_local(
            index_path, embeddings=embedding, allow_dangerous_deserialization=True # checking for trust local files
        )
        return vector_store

    # making conversion if not created
    chunks = language_translation_transcript(video_id, to_translate)

        # error checking case because if any error occured of
        #transcript not found or faiss object so python will give str object has no attribute as_retriever()
    if isinstance(chunks, str):  
        return chunks
    
    if not chunks:
        return "No chunk available for embedding"

    vector_store = FAISS.from_texts(chunks, embedding)

    # saving in disk for reuse
    vector_store.save_local(index_path)

    # print(f"Vector store cached to {index_path}")
    return vector_store

def get_retriever(video_id,to_translate="en",k=2,force_refresh=False):
    """
    Returns a retriever built on top of the cached/embedded vector store.
    k = number of relevant chunks to retrieve per query.
    """
    vector_store = get_vector_store(video_id, to_translate, force_refresh)
    if isinstance(vector_store, str):  # error message case — add this check
        return vector_store

    retriever = vector_store.as_retriever(search_kwargs={"k": k})

    llm = ChatOpenAI(temperature=0)
    #Create the document compressor (LLMChainExtractor)
    compressor = LLMChainExtractor.from_llm(llm)
    # Combine the base retriever and the compressor into the Contextual Compression Retriever
    compression_retriever = ContextualCompressionRetriever(
        base_compressor=compressor,
        base_retriever=retriever
        )
    return compression_retriever

def search_transcript(video_id, query, to_translate="en", k=2):

    """
    Quick helper: search the video transcript for chunks relevant to a query.
    Useful for testing retrieval before wiring up the full RAG chain.
    """
    retriever = get_retriever(video_id, to_translate, k)
    if isinstance(retriever, str):  # error message case
        return retriever

    results = retriever.invoke(query)
    return [doc.page_content for doc in results]


# Same reasoning as translation_and_chunking.py — only run test code when this
# file is executed directly, not when the server imports it.
if __name__ == "__main__":
    vector_store = get_vector_store(video_id, "en")
    retriever = get_retriever(video_id, "en", k=2)
    results = search_transcript(video_id, "what is this video about?", "en")
    for r in results:
        print(r, "\n---")