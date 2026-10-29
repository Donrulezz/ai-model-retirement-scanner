from openai import OpenAI

client = OpenAI()


def summarize(text):
    r = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Summarize: " + text}],
    )
    return r.choices[0].message.content
