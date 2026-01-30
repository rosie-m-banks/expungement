from datetime import datetime
from datetime import timedelta

def check_ans(answer):
    if 'y' in answer.lower():
        return True
    else:
        return False

def non_expungable_felony(felony):
    with open('section13.txt', 'r') as file:
        for line in file:
            if felony in line:
                return True
    return False

def non_violent_felony(felony):
    with open('section571.txt', 'r') as file:
        for line in file:
            if felony in line:
                return False
    return True

def reclassified_felony(felony):
    with open('reclassified.txt', 'r') as file:
        for line in file:
            if felony in line:
                return True
    return False

def felony_path(dates, today_date):
    ten_years = all(today_date - date >= timedelta(days=3652) for date in dates)
    if not ten_years:
        return False
    sex_offense = str(input("Are they a sex offender? (yes/no) "))
    if check_ans(sex_offense):
        return False
    other_convictions = str(input("Are there any other convictions (felonies)? (yes/no) "))
    if check_ans(other_convictions):
        return False
    pending = str(input("Are there any pending charges? (yes/no) "))
    if check_ans(pending):
        return False
    
    return True

def deferred_path(felony_charges, dates, restitution_paid, today_date):
    if (len(felony_charges) > 2):
        return False
    if all(non_violent_felony(felony) for felony in felony_charges):
        five_years = all(today_date - date >= timedelta(days=365*5 + 1) for date in dates)
        if not five_years:
            return False
        pending = str(input("Are there any pending charges? (yes/no) "))
        if check_ans(pending):
            return False
        return True
    if any(non_expungable_felony(felony) for felony in felony_charges):
        return False
    return felony_path()
    

def dismissed_path(sol):
    if not sol:
        return False
    pending = str(input("Are there any pending midemeanor / felony charges? (yes/no) "))
    if check_ans(pending):
        return False
    return True

def convicted_path(felony_charges, dates, restitution_paid, today_date):
    num_real_felonies = 0
    reclassified = all(reclassified_felony(felony) for felony in felony_charges)
    if reclassified:
        commutation = all(today_date - date >= timedelta(days=30) for date in dates)
        if not commutation:
            return False
        if not restitution_paid:
            return False
        
        other_crime = str(input("Are they serving a sentence in OK or another state? (yes/no) "))
        if check_ans(other_crime):
            return False
        return True

    elif any(non_expungable_felony(felony) for felony in felony_charges):
        return False
    else:
        num_real_felonies += 1
    if num_real_felonies > 2:
        return False
    else:
        return felony_path(dates, today_date)


def main():
    today_date = datetime.now().date()
    num_cases = int(input("How many cases are there? (numerical input) "))
    felony_charges = []
    dates = []
    has_conviction = False
    has_deferred = True
    restitution_paid = True
    sol = True
    for i in range(num_cases):
        num_counts = int(input(f"How many felony counts are there for case {i+1}? (numerical input) "))
        
        for j in range(num_counts):
            felony_charges.append(str(input(f"What was felony count {j+1}? (give exact wording) ")))
        conviction = str(input("Were they convicted? (yes/no) "))
        date_str = str(input(f"When was the end of the sentence / date of dismissal? (YYYY-MM-DD) "))
        dates.append(datetime.strptime(date_str, "%Y-%m-%d").date())

        has_conviction = has_conviction or check_ans(conviction)
        if check_ans(conviction):
            restitution_paid = str(input("Has the restitution been paid / all treatment programs completed? (yes/no) "))
            if not check_ans(restitution_paid):
                restitution_paid = False
        else:
            deferred = check_ans(str(input("Was the case deferred? (yes/no) ")))
            if deferred:
                sol = sol and check_ans(str(input("Has the statue of limitations expired or will the DA not file charges? (yes/no) ")))
                
            has_deferred = has_deferred and deferred
    if has_conviction:
        ans = convicted_path(felony_charges, dates, restitution_paid, today_date)
    else:
        if has_deferred:
            ans = deferred_path(felony_charges, dates, restitution_paid, today_date)
        else:
            ans = dismissed_path(felony_charges, dates, restitution_paid, today_date, sol)
    
    if ans:
        print("The case is eligible for expungement.")
    else:
        print("The case is not eligible for expungement.")

if __name__ == "__main__":
    main()