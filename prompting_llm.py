from embedding_and_retrieving import search_transcript
from langchain_openai import ChatOpenAI
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser


model = ChatOpenAI()

video_id = "ukzFI9rgwfU"

def answer_query(video_id,query,to_translate="en",k=4):
    # setting prompt 
    prompt = PromptTemplate(template="""
    You are a helpful assistant answering questions about a YouTube video
    using only the transcript context provided below.

    If the answer is not present in the context, say you don't know —
    do not make up information.

    Context:
    {context}

    Question: {question}

    Answer:
    """,
    input_variables=["context", "question"],)

    chunks = search_transcript(video_id,query,to_translate,k=k)
    if isinstance(chunks,str):
        return chunks
    if not chunks:
        return "I couldn't find anything relevant to your question in this video."

    context = "\n\n".join(chunks)
    parser = StrOutputParser()
    chain = prompt | model | parser
    response = chain.invoke({"context":context,"question":query})

    return response

# Only runs when you execute this file directly — this is the one that matters most
# to guard, since without it, every server restart would trigger a real OpenAI API call.
if __name__ == "__main__":
    answer = answer_query(video_id, query="what is machine learning")
    print(answer)