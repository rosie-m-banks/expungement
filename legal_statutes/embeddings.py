import os
import numpy as np
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold

class GetCosineSimilarity():
    def __init__(self, client=None):
        
        genai.configure(api_key=os.environ["GEMINI_API_KEY"])
        
        self.client = client if client is not None else genai.GenerativeModel('gemini-2.5-flash')
        self.embeddings = []
        self.crimes = []

    def format_file_embeddings(self, file_path):
        crimes = []
        with open(file_path, 'r') as file:
            lines = file.readlines()
            for line in lines:
                crimes.append(str(line))
        self.crimes = crimes
        return crimes

    def embed_file(self, file_path):
        crimes = self.format_file_embeddings(file_path)
        self.embeddings = self.embed_text(crimes)

    def embed_text(self, text:list[str]):
        result = genai.embed_content(
            model="models/gemini-embedding-001",
            content=text,
        )
        embeddings = np.array(result['embedding'])
        # Normalize embeddings
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings / norms
        return embeddings

    def get_k_best_cosine_similarity(self, query, k=5):
        result = genai.embed_content(
            model="models/gemini-embedding-001",
            content=query,
        )
        query_embedding = np.array(result['embedding'])
        scores = np.dot(self.embeddings, query_embedding)
        top_indices = np.argsort(scores)[-k:][::-1]

        results = [(self.crimes[i], scores[i]) for i in top_indices]
        return results
    
    def get_best_from_top_k(self, top_k, query):
        
        crime_string = ""
        for crime, score in top_k:
            crime_string += f"{crime}\n "
        crime_string = crime_string[:-2]
        completion = self.client.generate_content(
            f"I have a list of newline separated legal statute descriptions {crime_string}.\
                    I have a legal statute description {query}. Of the counts provided, does this statute match any of them? If yes, only output \
                        the specific count it matches. Otherwise, return 0. Do not return anything else.",
            safety_settings={
                HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
            }
        )
        if completion.text == "0":
            return None
        print(completion.text)
        return completion.text
    
    def get_matching_crime(self, query):
        best_vals = self.get_k_best_cosine_similarity(query, 5)
        return self.get_best_from_top_k(best_vals, query)