from embeddings import GetCosineSimilarity
import numpy as np
import time

sim_creator = GetCosineSimilarity()

crims_13 = sim_creator.embed_file("section13.txt")


with open("section13_embed.txt", 'w') as f:
    np.savetxt(f, crims_13)

time.sleep(30)


crims_571 = sim_creator.embed_file("section571.txt")


with open("section571_embed.txt", "w") as f:
    np.savetxt(f, crims_571)
time.sleep(30)

crims_reclass = sim_creator.embed_file("reclassified.txt")


with open("reclassified_embed.txt", "w") as f:
    np.savetxt(f, crims_reclass)
time.sleep(30)


crims_sora = sim_creator.embed_file("SORA.txt")

with open("SORA_embed.txt", "w") as f:
    np.savetxt(f, crims_sora)