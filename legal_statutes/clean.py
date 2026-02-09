with open("section571.txt", "r") as file:
    lines = file.readlines()
    cleaned_lines = []
    current_line = ""
    for line in lines:
        line = line.strip()
        if line[1] == "." or line[2] == ".":
            cleaned_lines.append(current_line)
            current_line = line[3:] if line[1] == "." else line[4:]
        else:
            current_line += f" {line}"
    cleaned_lines.append(current_line)
    with open("section571_clean.txt", "w") as file:
        for line in cleaned_lines:
            file.write(line + "\n")