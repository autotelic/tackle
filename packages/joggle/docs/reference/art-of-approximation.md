# The Art of Approximation in Science and Engineering

*A textbook of lying and cheating.*

Sanjoy Mahajan — MIT 6.055J / 2.038J, Spring 2008.

- Source: https://ocw.mit.edu/courses/6-055j-the-art-of-approximation-in-science-and-engineering-spring-2008/
- Licence: MIT OpenCourseWare, CC BY-NC-SA 4.0.
- Author's own book: *Street-Fighting Mathematics* (MIT Press, 2010), a later
  and fuller version of this course.

Converted from the course PDF so the text can be read and searched in the
repository. The prose, the parts, the chapters and the numbered sections are
faithful to the source.

Equations, the constants table and the tree diagrams are rendered as the
extraction produced them, so they are kept in fenced blocks: the spacing IS the
diagram, and reflowing it would destroy it. Figures that are images do not
extract; where the page carried a caption as text, the caption remains.

---

MIT OpenCourseWare http://ocw.mit.edu

6.055J / 2.038J The Art of Approximation in Science and Engineering Spring 2008

For information about citing these materials or our Terms of Use, visit: http://ocw.mit.edu/terms.

Back-of-the-envelope numbers

```
Symbol      What                                    Value       Units

π           pi                                           3
G           Newton’s constant                        7 · 10−11 kg−1 m3 s−1
c           speed of light                           3 · 108    m s−1
kB          Boltzmann’s constant                        10−4 eV K−1
e           electron charge                        1.6 · 10−19 C
σ           Stefan–Boltzmann constant                6 · 10−8 W m−2 K−4
msun        Solar mass                               2 · 1030 kg
Rearth      Earth radius                             6 · 106    m
θmoon/sun   angular diameter                            10−2
ρair        air density                                  1
ρrock       rock density                                 5
�c                                                    200       eV nm
Lwater
 vap        heat of vaporization                         2
γwater      surface tension of water                    10−1 N m−1
a0          Bohr radius                                0.5      Å
a           typical interatomic spacing                  3      Å
NA          Avogadro’s number                        6 · 1023
Efat        combustion energy density                    9
Ebond       typical bond energy                          4      eV
e2 /4π0
            ﬁne-structure constant α                    10−2
    �c
p0          air pressure                                105     Pa
νair        kinematic viscosity of air             1.5 · 10−5
νwater      kinematic viscosity of water                10−6 m2 s−1
day                                                     105     s
year                                                π · 107     s
F           solar constant                             1.3
AU          distance to sun                        1.5 · 1011 m
Pbasal      human basal metabolic rate                100       W
Kair        thermal conductivity of air              2 · 10−2
K           . . . of non-metallic solids/liquids         1
Kmetal      . . . of metals                             102
cair
 p          speciﬁc heat of air                          1
cp          . . . of solids/liquids                     25
```

Handling complexity: The art of approximation

```
                                             how to handle complexity

           organizing complexity                                                          discarding complexity

  divide and conquer   abstraction                discarding fake complexity (symmetry)
                                                           (lossless compression)                                      (lossy compression)

                                     proportional reasoning   conservation    dimensional analysis     special cases     discretization   springs

Contents

1. Preview                         4

Part 1 Divide and conquer          6
2. Assorted subproblems            7
3. Alike subproblems              19

Part 2 Symmetry and Invariance    20
4. Symmetry                       21
5. Proportional reasoning         26
6. Box models and conservation    40
7. Dimensions                     48

Part 3 Discarding Information     68
8. Special cases                  69
9. Discretization                 91
10.Springs                        97

Part 4 Backmatter                129
11.Bon voyage!                   130
Bibliography                     133
Index                            135
```

## 1. Preview

An approximate model can be better than an exact model! This counterintuitive statement suggests a few questions. First, how can approximate models be at all useful? Should we not strive for exactness? Second, what makes some models more useful than others? On the ﬁrst question: An approximate answer is all that we can understand because our minds are a small part of the world itself. So when we represent or model the world, we have to throw away aspects of the world in order for our minds to contain the model. On the second question: Making useful models means discarding less important information so that our minds may grasp the important features that remains. I wrote this book to show you how to discard the less important information and thereby to make the most useful approximate answers. From thinking about and teaching this subject for many years, I ﬁnd that the most useful techniques fall into three groups:

1. Divide and conquer (managing complexity)
− Hetrogenous hierarchies − Homogeneous hierarchies

2. Symmetry and invariance (removing spurious complexity)
− Proportional reasoning − Conservation/box models − Dimensionless groups

3. Lying (discarding complexity)
− Special cases − Spring models − Fractional changes − Discretization

The two divide-and-conquer techniques help you manage complexity. The three symmetry techniques help you remove superﬂuous complexity. These ﬁrst two groups do lossless

compression. The three lying techniques help you discard complexity. This third group does lossy compression. Using these techniques, we will explore the natural and manmade worlds. Applications include:

- turbulent drag: or how falling coffee ﬁlters tell us the fuel efﬁciency of airplanes.
- xylophone acoustics: or why pianos are tuned with the lower notes below the ideal,
equal-tempered frequency and with the higher notes above the ideal, equal-tempered frequency.

- the design of compact discs: or how Beethoven’s ninth symphony helps you ﬁnd the
spacing between the pits.

- period of a pendulum as a function of amplitude: or how hard it was to navigate 300
years ago.

- the size distribution of eddies in turbulent ﬂow: or how stars twinkle.
- the bending of starlight by the sun: or the size of a black hole.
- biomechanics: how high an animal jumps as a function of its size.
None of these problems has a simple analytic solution. The world – whether manmade or natural – rarely offers problems limited to one ﬁeld of study, let alone problems whose equations have an analytic solution. To understand aspects of the world even partially, we need to use the preceding techniques, to make models that keep only the important features of a problem. By making such models, we make understanding and designing more enjoyable. So the hidden although less tangible purpose of this book is to amplify your curiosity about the world.

# Part 1. Divide and conquer

```
  2. Assorted subproblems                                        7
  3. Alike subproblems                                          19
```

Divide-and-conquer reasoning – breaking large problems into small ones – is useful in many contexts. Each example of it has unique features, but two broad reasoning categories stand out. In the ﬁrst category, you break the large problem into unlike, or assorted subproblems. An example is estimating the number of piano tuners in New York or, since this problem was made famous by Fermi, in Chicago, where Fermi spent much of his career. You might break it into fragments such as the number of pianos, how often each one is tuned, and how long it takes to tune a piano. In the second category, you break the large problem into similar or identical subproblems. An example is merge sort, which breaks a list to be sorted into two halves, each sorted using merge sort – an example of recursion. The next two chapters contain extended examples in each category.

## 2. Assorted subproblems

For the ﬁrst example of dividing into unlike subproblems, we estimate the spacing between pits on a CD ROM. Then we estimate the amount of oil that the United States imports annually.

### 2.1 Pits on a CDROM

Q: What is the spacing between the pits on a CDROM? The pits (indentations) are the memory elements, each pit storing one bit of information. A quick estimate comes from turning over a CDROM and enjoying the brilliant colors. The colors arise because the arrangement of pits diffracts visible light by a signiﬁcant angle, and the angle depends strongly on the wavelength (or color). So the pits are spaced comparably to the wavelength of light, say about 1 μm. A second estimate might come from knowing a bit about the laser in a CD player or in a CDROM drive. It is a near-infrared laser, so its wavelength – which will be comparable to the pit size and spacing – is slightly longer than visible-light wavelengths. Since visiblelight wavelengths range from 350 to 700 nm or from 0.4 to 0.8 μm, a reasonable estimate for the pit spacing is again 1 μm. These two estimates agree, which increases our conﬁdence in each estimate. Here is why. Because the methods are so different, an error in one method is likely to be signiﬁcantly different from an error in the second method. Therefore, if the estimates agree, they are probably both reasonable. The lesson is to use as many diverse methods as you can. The third method uses divide-and-conquer reasoning. The capacity and area together determine the pit spacing, if we make the useful approximation that the pits are regularly spaced. [This approximation is an example of discarding information, which is the extended topic of Part 3.] The area is A ∼ (10 cm)2 . The capacity is often on the box: 640 MB, which is about 5 gigabits since each byte is 8 bits. After including error-correcting bits, perhaps the capacity is 6 or 7 gigabits.

The pit spacing d comes from arranging those N ∼ 10 gigabits into a regular lattice of bits:

```
                                   
                                     A 10 cm
                               d∼       ∼       ∼ 1 μm.
                                     N     105
```

Once again, the estimate is around 1 μm. Any result that we derive three times has to be true! You do not need to take the capacity ﬁgure on faith. Instead, use divide-and-conquer reasoning based on how much information would be needed to encode the music on an audio CD. The information needed depends on the play time, the sampling rate, and the sample size (number of bits). A typical CD holds about 20 popular-music songs, each about 3 minutes long, so it is about 1 hour. An alternative piece of (perhaps bogus) history conﬁrms this estimate: The engineers at Philips who invented the CD format and player allegedly insisted that the format hold Beethoven’s Ninth Symphony, around 74 minutes. The sampling rate is 44 kHz. Suppose you had remembered the 44 but did not remember the units: whether they were kHz or MHz. How do you choose? Human hearing extends to about 20 kHz. For comparison, the 60 Hz line-voltage hum is quite well into the audible range. Lossless sampling of sound, according to Shannon’s sampling theorem, needs to have a rate of at least 2 × 20 kHz. The inventors of the CD format chose a slightly higher rate, so that one can make a half-decent anti-alias ﬁlter. [If you want to know more about anti-alias ﬁlters, let me know!] Even the constraint of an anti-alias ﬁlter does not require a sampling rate of 44 MHz. Indeed, the sampling rate is 44 kHz. Each sample requires 32 bits: two channels (stereo) each needing 16 bits per sample. The 16 bits is a reasonable compromise between the utopia of exact volume encoding (∞ bits per sample per channel) and the utopia of minimal storage (1 bit per sample per channel). Why compromise at 16 bits rather than, say, 50 bits? Because 50 bits, while easy nowadays to represent digitally, implies absurd analog hardware that has an accuracy of 1 part in 250 . So the capacity is roughly

```
                                  3600 s 4.4 × 104 samples 2 × 16 bits
                  N ∼ 1 hours ×         ×                 ×            .
                                   1 hr          1s         1 sample
```

First do the important part: the powers of ten. The 3600 contributes three; the 4.4 × 104 contributes four; and the 2 × 16 contributes one; for a total of eight. The mantissas – the parts in front of the power of ten – contribute 3.6 × 4.4 × 3.3. This multiplication is simpliﬁed if you remember that there are only two numbers in the world: 1 and ‘few’. The only rule to remember is that (few2 = 10, so ‘few’ acts a lot like 3. Then 3.6 × 3.3 is roughly 10, perhaps a bit higher. Then 3.6 × 4.4 × 3.3 ∼ 50. So the estimate for the capacity is roughly 50 × 108 ∼ 5 · 109 , which agrees amazingly well with the ﬁgure from a box of CDROM’s. Therefore, the divide-and-conquer estimate for the capacity gives us even more conﬁdence in our estimate for the pit spacing.

```
   2 Assorted subproblems                                                                         9
```

### 2.2 Tree representations

The structure of a divide-and-conquer estimate, with the steps of subdividing, is hierarchical. An ideal representation of hierarchical structure is a tree. Therefore to illustrate this representation, this section redoes our analysis of the pit spacing using trees. The estimate using the area and capacity of a CDROM is the most elaborate method in Section 2.1 for ﬁnding the pit spacing, so let’s represent it as a tree. The root of

```
   the tree is ‘capacity, area’, a tag that reminds us of the method. As the tag suggests,   capacity
```

to do the estimate requires ﬁnding the capacity and area, so the tree starts with two branches. The area is easy to estimate, so the next step is to subdivide the capacity into easier parts. The ﬁrst method is to look on a CDROM box, which says something like ‘capacity 700MB’. A second method is to estimate the bits required to store the audio information that ﬁt on an audio CD, by estimating the playing time, the sampling rate, and the bits per sample, where here the two channels for stereo are included in the bits per sample.

```
                                                          capacity, area

                                      capacity                                    area

                       look on box                  audio content

                                     playing time   sample rate     bits/sample
```

Now ﬁll in the numbers at the leaves and propagate toward the root of the tree. The audio lasts for about an hour, which we estimated as either 20 popular music songs of 3 minutes duration or as Beethoven’s Ninth Symphony. The sampling rate is 44 kHz. The samples are 32 bits each including the factor of two for stereo. The tree including these values is:

```
                                                          capacity, area

                                      capacity                                    area
                                      5 × 1010

                       look on box                  audio content
                         700 MB

                                     playing time   sample rate     bits/sample
                                        1 hour        44 kHz             32
```

This tree is one subtree of the whole analysis. That analysis included two other methods: knowledge of the laser inside a CD player, and observing the shimmering colors due to diffraction. Including those methods – and ﬁnding that the three methods agree – makes the estimate of 1 μm robust. In pictorial terms, it makes the tree sturdy:

```
                                                                              pit spacing
                                                                                 1 μm

                                          capacity, area                     internal laser   diﬀraction colors
                                              1 μm                               1 μm               1 μm

                      capacity                                      area
                      5 × 1010                                    (10 cm)2

       look on box                  audio content
         700 MB                       5 × 1010

                     playing time   sample rate     bits/sample
                        1 hour        44 kHz             32
```

A tree is well suited for representing divide-and-conquer reasoning. This tree summarizes the whole analysis in one ﬁgure. This compact representation make it easier to ﬁnd and ﬁx mistakes in the numbers or the structure or to see which parts of the estimate are the least reliable (and probably need more subdividing).

### 2.3 Oil imports

For the next example of divide-and-conquer reasoning, we will make a tree from the beginning. The problem is to estimate how much oil the United States imports, in barrels per year. There are cars other uses fraction imported many ways to estimate this number – good news for making robust estimates. Here I estimate it by estimating how much oil cars use, then adjusting that number to account for two items: ﬁrst, that cars are not the only consumer of oil; and second, that imports are only a fraction of the oil consumed. The starting tree has just three leaves. The rightmost two leaves are hard to guess values for, but dividing and conquering does not help. So I’ll have to guess them. Cars are a major consumer of oil, but there are other transport uses (trucks, trains, and planes), and there is heating and cooling. Given how important these other uses are, perhaps cars account for one-half of the oil consumption: a signiﬁcant fraction leaving room for other signiﬁcant uses. So I need to double the car result to account for other uses. Imports are a large fraction of total consumption, otherwise we would not read so much in the popular press about oil production in other countries, and about our growing dependence on imported oil. Perhaps one-half of the oil usage is imported oil. So I need to halve the total use to ﬁnd the imports. The third leaf, cars, is too complex to guess a number immediately. So divide and conquer. One subdivision is into number of cars, miles driven by each car, miles per gallon, and gallons per barrel:

```
    2 Assorted subproblems                                                                                 11
                                                                           imports

                                   cars                                   other uses   fraction imported

                 N    miles/year          gallons/mile   barrels/gallon
```

Now guess values for the unnumbered leaves. There are 3×108 people in the United States, and it seems as if even babies own cars. As a guess, then, the number of cars is N ∼ 3 × 108 . The annual miles per car is maybe 15,000. But the N is maybe a bit large, so let’s lower the annual miles estimate to 10,000, which has the additional merit of being easier to handle. A typical mileage would be 25 miles per gallon. Then comes the tricky part: How large is a barrel? One method to estimate it is that a barrel costs about $100, and a gallon of gasoline costs about $2.50, so a barrel is roughly 40 gallons. The tree with numbers is:

All the leaves have values, so I can propagate upward to the root. The main operation is multiplication. For the ‘cars’ node:

```
                              104 miles   1 gallon   1 barrel
             3 × 108 cars ×             ×          ×          ∼ 3 × 109 barrels/year.
                              1 car–year 25 miles 40 gallons
```

The two adjustment leaves contribute a factor of 2 × 0.5 = 1, so the import estimate is

```
                                                  3 × 109 barrels/year.
```

For 2006, the true value (from the US Dept of Energy) is 3.7 × 109 barrels/year! This result, like the pit spacing, is surprisingly accurate. Why? Section 2.5 explains a random-walk model for it, which suggests that the more you subdivide, the better. But before discussing that model, try one more example.

### 2.4 Gold or bills?

Having broken into a bank vault, should you take the $100 bills or the gold? The choice depends on how easily and losslessly you can fence the loot and on other issues outside the scope of this book. But we can study one question: Which choice lets you carry away the most money? The weight or the volume may limit how much you can carry and, more importantly for this problem, affect your choice. To make a start, let’s assume that you are limited by the weight (actually, the mass) that you can carry, The problem then depends on two subproblems: the value per mass for $100 bills and for gold. In tree form:

The value per mass of gold might be a familiar ﬁgure from the newspaper or from the ﬁnancial section of the evening news. It is now (2008) about $800/oz (oz being the abbreviation for an ounce). As a rough check on the memory – e.g. should the price be $80/oz or $8000/oz? – here is another method. When the gold standard was reintroduced as the dollar standard in 1945, gold was set at $35/oz. Inﬂation has probably devalued the dollar by at least a factor of 10 since then, so gold should be around $350/oz now. The half-remembered ﬁgure of $800/oz seems reasonable. Finding the value per mass of a dollar bill starts with this tree:

```
                                          value/mass for $100

                                              value      mass
```

The value is speciﬁed in the problem as $100, but the mass needs work. It breaks into the volume times the density, so the value per mass tree becomes:

```
                                       value/mass for $100

                                      value              mass

                                                density         volume
```

The volume breaks into length times width times thickness, so the tree grows:

```
                               value/mass for $100

                            value                mass

                                    density                volume

                                                length      width        thickness
```

To ﬁnd the length and width of a bill, lay a ruler next to a dollar bill or guess that a bill measures 2 or 3 inches by 6 inches or 6 cm × 15 cm. To develop a feel for sizes, make a guess and then, if you feel uneasy, check your answer with a ruler. As your feel for sizes develops, you will need the ruler less frequently. Guessing the thickness of a bill is harder than guessing the length or width. However, as George Washington Plunkitt, onetime boss of Tammany Hall, said: ‘I seen my opportunities and I took ’em.’ Pretend that a dollar bill is made from ordinary paper. To ﬁnd its thickness, look around. Next to the computer used to compose this book sits an inkjet printer; next to the printer is a ream of printer paper. If we know how thick the ream is and how many sheets it has, then we know the thickness of one sheet. You might call this technique multiply and conquer. The general lesson is that tiny values, those much below typical human experience, need to be magniﬁed to make them easy to estimate. Large values, those much above typical human experience, need to be broken into smaller parts to make them easy to estimate. With this last step of magnifying the sheet’s thickness, the full tree for the value per mass of the bill becomes:

```
   2 Assorted subproblems                                                                       13

                        value/mass for $100

                     value               mass

                             density              volume

                                         length   width                 thickness

                                                           sheets in a ream    ream thickness
```

The ream (500 sheets) is roughly 5 cm thick. The only missing leaf value is the density of a bill. To ﬁnd the density, use what you know: Money is paper. Paper is wood or fabric, except for many complex processing stages whose analysis is far beyond the scope of this book. When a process, here papermaking, looks formidable, forget about it and hope that you’ll be okay anyway. More important is to get an estimate; correct the egregiously inaccurate assumptions later (if ever). How dense is wood? Wood barely ﬂoats, so its density is roughly that of water, which is ρ ∼ 1 g cm−3 . So the density of a $100 bill is roughly 1 g cm−3 . Here is a tree including all the leaf values:

```
                        value/mass for $100

                    value                 mass
                    $100

                              density             volume
                             1 g cm−3

                                         length    width                 thickness
                                          6 cm     15 cm

                                                           sheets in a ream    ream thickness
                                                                  500              5 cm
```

Now propagate the leaf values upward. The thickness of a bill is roughly 10−2 cm, so the volume of a bill is roughly

```
                                  V ∼ 6 cm × 15 cm × 10−2 cm ∼ 1 cm3 .

   So the mass is

                                        m ∼ 1 cm3 × 1 g cm−3 ∼ 1 g.
```

How simple! Therefore the value per mass of a $100 bill is $100/g. To choose between the bills and gold, compare that value to the value per mass of gold. Unfortunately our ﬁgure for gold is in dollars per ounce rather than per gram. Fortunately one ounce is roughly 27 g so $800/oz is roughly $30/g. Moral: Take the $100 bills but leave the $20 bills.

### 2.5 Random walks

The estimates in Section 2.1 and Section 2.3 are surprisingly accurate. The true pit spacing in a CDROM varies from 1 μm to 3 μm, according to the so-called Red Book where Philips and Sony give the speciﬁcation of the CDROM; our estimate of 1 μm is not too bad. The true value for the oil imports is only 10% different from our estimate. Equally important, the estimates are more accurate after doing divide-and-conquer reasoning. My 95% probability interval for oil imports, if I had to guess a value without subdividing the problem, is say from 106 b/yr to 1012 b/yr. In other words, if someone had claimed that the value is 10 million barrels per year, it would have seemed low, but I wouldn’t have bet too much against it. After doing the divide-and-conquer estimate, I’d have been surprised if the true answer were more than a factor of 10 smaller or larger than the estimate. This section presents a model for guessing in order to explain how divide-and-conquer reasoning can make estimates more accurate. The idea is that when we guess a value far outside our intuitive experience – for example, micron-sized distances or gigabarrels – the error in the exponent will be proportional to the exponent. For example, when guessing a quantity like 109 in one gulp, I really mean: ‘It could be, say, 106 on the low side or, say, 1012 on the high side.’ And when guessing a quantity like 1030 (the mass of the sun in kilograms), I would like to hedge my bets with a region like 1020 to 1040 . So, in this model any quantity 10β is really shorthand for

```
                                             10β → 10β−β/3 . . . 10β+β/3 .
```

Now further simplify the model: Replace the range of values by its endpoints. So, if we try to guess a quantity whose true value is 10β , we are equally likely to guess 102β/3 or 104β/3 . A more realistic model would include 10β as a likely possibility, but the simplest model is easy to simulate and to reason with (that justiﬁcation is a fancy way to say that I am lazy). To see the consequences of the model, I’ll compare subdividing and not subdividing by using a numerical example. Suppose that we want to guess a quantity whose true value is 1012 . Without subdividing, we might guess 108 or 1016 (adding or subtracting one-third of the exponent), a wide range. Compare that range to the range when we subdivide the estimate into 16 equal factors. Each factor is 1012/16 = 103/4 . When guessing each factor, the model says that we would guess 101/2 or 101 each with p = 0.5. Here is an example of choosing 16 such factors randomly from 101/2 and 101 and multiplying them:

100.5 · 100.5 · 101 · 100.5 · 101 · 101 · 100.5 · 101 · 100.5 · 100.5 · 100.5 · 100.5 · 100.5 · 100.5 · 101 · 100.5 = 1010.5

Here are three other randomly generated examples:

```
         101 · 100.5 · 101 · 101 · 101 · 101 · 100.5 · 101 · 100.5 · 101 · 101 · 100.5 · 100.5 · 101 · 101 · 100.5 = 1013.0
```

101 · 101 · 100.5 · 100.5 · 101 · 101 · 100.5 · 100.5 · 100.5 · 100.5 · 101 · 101 · 101 · 100.5 · 100.5 · 100.5 = 1011.5 100.5 · 100.5 · 100.5 · 100.5 · 100.5 · 101 · 100.5 · 100.5 · 101 · 101 · 101 · 100.5 · 100.5 · 100.5 · 101 · 100.5 = 1010.5

These estimates are mostly within one factor of 10 from the true answer of 1012 , whereas the one-shot estimate might be off by four factors of 10. What has happened is that the

```
     2 Assorted subproblems                                                                     15
```

errors in the individual pieces are unlikely to point in the same direction. Some pieces will be underestimates, some will be overestimates, and the product of all the pieces is likely to be close to the true value. This numerical example is our ﬁrst experience with the random walk. Their crucial feature is that the expected wanderings are signiﬁcantly smaller than if one walks in a straight line without switching back and forth. How much smaller is a question that we will answer in Chapter 8 when we introduce special-cases reasoning.

### 2.6 The Unix philosophy

Organizing complexity by breaking it into manageable parts is not limited to numerical estimation; it is a general design principle. It pervades the Unix and its offspring operating systems such as GNU/Linux and FreeBSD. This section discusses a few examples.

2.6.1 Building blocks and pipelines

Here are a few of Unix’s building-blocks programs:

- head: prints the ﬁrst n lines from the input; for example, head -15 prints the ﬁrst 15
```
       lines.
```

- tail: prints the last n lines from the input; for example, tail -15 prints the last 15
```
       lines.
```

How can you use these building blocks to print the 23rd line of a ﬁle? Divide and conquer! One solution is to break the problem into two parts: printing the ﬁrst 23 lines and, from those lines, printing the last line. The ﬁrst subproblem is solved with head -23. The second subproblem is solved with tail -1. To combine solutions, Unix provides the pipe operator. Denoted by the vertical bar |, it connects the output of one program to the input of another command. In the numerical estimation problems, we combined the solutions to the subproblems by using multiplication. The pipe operator is analogous to multiplication. Both multiplication in numerical estimation, and pipes in programming, are examples of composition operators, which are essential to a divide-and-conquer solution. To print the 23rd line, use this combination:

head -23 | tail -1

To tell the system where to get the input, there are alternatives:

1. Use the preceding combination as is. Then the input comes from the keyboard, and the
```
        combination will read 23 typed lines, print out the ﬁnal line from those 23 lines, and
        then will exit.
```

2. Tell head to get its input from a ﬁle. An example ﬁle is the dictionary. On my GNU/Linux
```
        laptop it is the ﬁle /usr/share/dict/words, with one word per line. To print the 23rd
        line (i.e. the 23rd word):

         head -23 /usr/share/dict/words | tail -1
```

3. Let head read from its idea of the keyboard, but connect the keyboard to a ﬁle. This
```
        method uses the < syntax:

         head -23 < /usr/share/dict/words | tail -1

         The < operator tells the shell (the Unix command interpreter) to connect /usr/share/dict/words
         to the input of head.
```

4. Like the preceding method, but use the cat program. The cat program copies its input
```
        ﬁle(s) to the output. So this extended pipeline has the same effect as the preceding
        alternative:

         cat /usr/share/dict/words | head -23 | tail -1

         It is slightly less efﬁcient than letting the shell redirect the input itself, because the longer
         pipeline requires running one extra program (cat).
```

This example introduced the Unix philosophy: To enable divide-and-conquer reasoning, provide useful small utilities and ways to combine them. The next section applies this philosophy to a whimsical example from a scavenger hunt created by Donald Knuth: Find the next word in the dictionary after ‘angry’, where the dictionary is alphabetized starting with the last letter, then the second-to-last letter, etc.

2.6.2 Sorting and searching

So, how do you ﬁnd the next word in the dictionary after ‘angry’, where the dictionary is alphabetized starting with the last letter, then the second-to-last letter, etc.? Divide the problem into two parts:

1. Make a reverse dictionary, alphabetized starting with the last letter, then the second-to­
```
        last letter, etc.
```

2. Printing the line after ‘angry’.
The ﬁrst problem subdivides into:

1. Reverse each line of a dictionary.
2. Sort the reversed dictionary.
3. Unreverse each line.
Unix provides sort for the second subproblem. For the ﬁrst and third problems, a search through the Unix toolbox, using man -k, says:

$ man -k reverse

```
build-rdeps (1)             - find packages that depend on a specific package to
bui...
col (1)                     - filter reverse line feeds from input
git-rev-list (1)            - Lists commit objects in reverse chronological order
rev (1)                     - reverse lines of a file or files
tac (1)                     - concatenate and print files in reverse
xxd (1)                     - make a hexdump or do the reverse.
```

Ah! rev is just the program for us. So the ﬁrst subproblem is solved with this pipeline:

rev < /usr/share/dict/words | sort | rev

The second problem – ﬁnding the line after ‘angry’ – is a task for the pattern-ﬁnding program grep. In the simplest usage, you tell grep a pattern, and it prints every line from its input that matches the pattern. The patterns are regular expressions. Their syntax can become arcane, but the most important features are simple. For example,

grep ’^angry$’ < /usr/share/dict/words

prints all lines that exactly match angry: The ˆ character matches the beginning of the line, and the $ character matches the end of the line. That invocation of grep is not useful except as a spell checker, since it tells us only that angry is in the dictionary. However, the -A option, you can tell grep how many lines to print after each matching line. So

grep -A 1 ’^angry$’ < /usr/share/dict/words

will print ‘angry’ and the word after it (in the regular dictionary):

angry angst

To print just the word after ‘angry’, follow the grep command with tail:

grep -A 1 ’^angry$’ < /usr/share/dict/words | tail -1

Now combine these two solutions into solving the scavenger hunt problem:

rev </usr/share/dict/words | sort | rev | grep -A 1 ’^angry$’ | tail -1

This pipeline fails with the error

rev: stdin: Invalid or incomplete multibyte or wide character

The rev program is complaining that it doesn’t understand some of the characters in the dictionary. rev is from the old, ASCII-only days of Unix, whereas the dictionary is modern and includes non-ASCII characters such as accented letters. To solve this unexpected problem, clean the dictionary before passing it to rev. The cleaning program is again grep, which can allow through only those lines that are pure ASCII. This command

```
        grep ’^[a-z]*$’ < /usr/share/dict/words
```

will print a dictionary made up only of unaccented, lowercase letters. In a regular expression, the * operator means ‘match 0 or more occurrences of the preceding regular expression’. The full pipeline is

grep ’^[a-z]*$’ < /usr/share/dict/words \ | rev | sort | rev \ | grep -A 1 ’^angry$’ | tail -1

where the backslashes at the end of the lines tell the shell to keep reading the command even though the line ended. The tree representing this solution is

```
                                                    word after angry in reverse dictionary
                                        grep ’^[a-z]*$’ | rev | sort | rev | grep -A 1 | tail -1

                           make reverse dictionary                              select word after angry
                    grep ’^[a-z]*$’ | rev | sort | rev                          grep -A 1 | tail -1

           clean dictionary   reverse      sort    unreverse   select angry and next word    print last of two words
          grep ’^[a-z]*$’       rev        sort      rev                grep -A 1                    tail -1
```

which produces ‘hungry’.

2.6.3 Further reading

To learn more about the principles of Unix, especially how the design facilitates divideand-conquer programming, see [1, 2, 3].

## 3. Alike subproblems

# Part 2. Symmetry and Invariance

```
  4. Symmetry                                                 21
  5. Proportional reasoning                                   26
  6. Box models and conservation                              40
  7. Dimensions                                               48
```

The ﬁrst part of this book discussed how to organize, and therefore how to manage complexity. The second and third parts discuss how to eliminate complexity, with this second part discussing three methods for ﬁnding and removing complexity that is not real. The three methods are proportional reasoning, conservation, and dimensional analysis, and are examples of symmetry reasoning. Symmetry is also a powerful technique on its own, even without using its for the three methods. The next chapter therefore presents general examples of symmetry reasoning, and the following chapters develop this method reasoning into the three methods of proportional reasoning, conservation, and dimensional analysis.

## 4. Symmetry

Symmetry is often thought of as a purely geometric concept, but it is useful in a wide variety of problems. Whenver you can use symmetry, use it and will simplify the solution. The following sections illustrate symmetry in calculus, geometry, and heat transfer.

### 4.1 Calculus

For what value of x is 3x − x2 a maximum? The usual method is to take the derivative:

```
                                      d
                                         (3x − x2 ) = 3 − 2x = 0,
                                      dx
```

whereupon xmax = 3/2. Although differentiating is a general method, its generality comes at a cost: that its results are often hard to interpret. One does the manipulations, and whatever formulas show up at the end, so be it. So, if you can ﬁnd a simpliﬁcation, you are likely to get a more insight into why the answer came out the way that it did. For this problem, symmetry simpliﬁes it enough that nothing remains to do. To see how, ﬁrst factor the equation into x(3 − x). Let xmax be where it has its maximum. The factors x and 3 − x can be swapped using the substitution x = 3 − x. In terms of x , the problem becomes maximizing (3 − x )x . This formula has the same structure as the original one x(3 − x)! So the symmetry operation preserves this structure. Since the x or x location of the maximum depends only on the structure, the location has the same numerical value whether in the x or x coordinate systems. So it is said to be invariant under the substitution operation. Therefore, in this problem, the x → 3 − x substitution is a symmetry. Since x = 3 − x and, as a result of symmetry, xmax = xmax , the only solution is xmax = xmax = 3/2. A similar, perhaps more telegraphic argument, is that the maximum is halfway between the two roots x = 0 and x = 3, so the maximum is, again, at xmax = 3/2. This argument implicitly contains symmetry, which is the justiﬁcation for saying that the maximum is midway between the roots.

The next calculus example, from electrical and mechanical engineering, is to maximize the response of a second-order system such as a damped spring–mass system or an LRC circuit. The response depends on the frequency and amplitude of the driving input, and is measured as the ratio of output to input amplitude. This ratio is the gain A, and a few applications of Newton’s second law produces

```
                                                    jω
                                   A(ω) =                   ,
                                              1 + jω/Q − ω2
                                                                                 √
```

where Q is the quality factor of the system (the inverse of the damping), j is measured in units of the natural frequency. The problem is to ﬁnd the peak response, meaning the frequency ωmax that maximizes the magnitude of the gain and the gain at that frequency. The magnitude of the gain is

```
                                                       ω
                                |A(ω)| = 
                                              (1 − ω2 )2 + ω2 /Q2
```

Because of the squares and square roots, a brute-force approach by taking the derivative will generate messy equations. So, use symmetry. What is the symmetry operation? It will be be a ﬂip of the coordinate system, but around what point? The value ω = 1 is special because that choice eliminates the denominator term (1 − ω2 )2 , which helps to minimize the denominator and maximize the gain. On the other hand, decreasing ω slightly could increase the gain because, at the cost of increasing (1 − ω2 )2 , it decreases the ω2 /Q2 term in the denominator. On the other hand, increasing ω slightly might produce a higher gain because it increases the numerator of the gain. To summarize: ω = 1 is special but slightly higher or lower than ω = 1 could be optimal too. Since ω = 1 is special, use it as the point that is preserved by the symmetry operation. For a symmetry operation, interchange the ω < 1 and ω > 1 ranges. Frequencies mostly matter as ratios to one another – for example in music – so do the interchange by deﬁning ω = 1/ω rather than ω = 1 − ω. With the reciprocal deﬁnition, the problem becomes to maximize the magnitude of A(ω ), where

```
                                                     j/ω
                                 A(ω ) =                            .
                                            1 + j/ω Q − 1/ω 2
```

Multiply numerator and denominator by 1 in the form of ω 2 /ω 2 :

```
                                                      jω
                                  A(ω ) =                       .
                                              ω 2 + jω/Q − 1
Its magnitude is
                                                       ω
                               |A(ω )| =                               .
                                              (1 − ω 2 )2 + ω 2 /Q2
```

This formula has the same structure as the magnitude in terms of ω itself, and this information is enough to solve for ωmax . Because of the isomorphic structure, ω max = ωmax . But by construction ω = 1/ω, so ω max is also 1/ωmax . The only solution is ωmax = ±1. Since the negative root is boring, the relevant solution is ωmax = 1 and the response there is

```
   4 Symmetry                                                                                      23

                                                             j
                                           A(ωmax ) =          = jQ.
                                                           1/Q
```

The factor of Q in the maximum response says that a lightly damped system, where Q  1, can reach a high amplitude if you push it at the so-called resonant frequency. The j says that the response at this resonant frequency lags the input by 90 degrees. In other words, the greatest push happens when the velocity, not the displacement, is a maximum.

### 4.2 Graphical symmetry

The following pictorial problem illustrates symmetry applied to a geometric problem, the traditional domain of symmetry:

How do you cut an equilateral triangle into two equal halves using the shortest, notnecessarily-straight path?

Here are several candidates among the inﬁnite set of possibilities for the path.

```
                     √                     √
               l = 1/ 2               l=       3/2                l=1               l = (a mess)
```

Let’s compute the lengths of each bisecting path, with length measured in units of the triangle side. The ﬁrst candidate encloses an equilateral triangle with one-half the area of the original triangle, so the sides of the smaller, shaded triangle are smaller by a factor of

```
   √                                                                 √
```

2. Thus the path, being one of those sides, has length 1/ 2. In the second choice, the
```
                                                                              √
```

path is an altitude of the original triangle, which means its length is 3/2, so it is longer than the ﬁrst candidate. The third candidate encloses a diamond made from two small equilateral triangles. Each small triangle has one-fourth the area of the original triangle with side length one, so each small triangle has side length 1/2. The bisecting path is two sides of a small triangle, so its length is 1. This candidate is longer than the other two. The fourth candidate is one-sixth of a circle. To ﬁnd its length, ﬁnd the radius r of the circle. One-sixth of the circle has one-half the area of the triangle, so

```
                                                                      √
                               2         1                1 1           3
                             πr = 6 × Atriangle = 6 × × × 1 ×             .
                                     2                2 2          2
                                                                
                            Acircle
                                                                        Atriangle

   Multiplying the pieces gives
                                                           √
                                                       2  3 3
                                                     πr =     ,
                                                           4
   and

                                                 
                                                      √
                                                     3 3
                                            r=           .
                                                      4π
```

The bisection path is one-sixth of a circle, so its length is

```
                                                           
                                                      √          √
                                       2πr π 3 3               π 3
                                   l=       =             =        .
                                        6      3     4π         12
                                                                   √
```

The best previous candidate (the ﬁrst picture) has length 1/ 2 = 0.707 . . .. Does the mess of π and square roots produce a shorter path? Roll the drums. . . :

```
                                          l = 0.67338 . . . ,
                        √
```

which is less than 1/ 2. So the circular arc is the best bisection path so far. However, is it the best among all possible paths? The arc-length calculation for the circle is messy, and most other paths do not even have a closed form for their arc lengths. Instead of making elaborate calculations on every path, of which there are many, try symmetry, which is the mathematical principle for the three methods in this part of the book. To use symmetry, replicate the triangle six times to make a hexagon, thereby replicating the candidate path as well. Here is the result of replicating the ﬁrst candidate where the bisection line goes straight across. The original triangle becomes the large hexagon, and the enclosed halftriangle becomes a smaller hexagon having one-half the area of the large hexagon. Compare that picture with the result of replicating the circular-arc bisection. The large hexagon is the same as for the last replication, but now the bisected area replicates into a circle. Which path has the shorter perimeter, the shaded hexagon or this circle? The isoperimetric theorem says that among all shapes with the same area the circle has the smallest perimeter. Since the circle and the smaller hexagon enclose the same area – which is three times the area of one triangle – the circle has a smaller perimeter than the hexagon, and it has a smaller perimeter than the result of replicating any other bisecting path. So the circular arc is the solution. The lesson of this example is that symmetry can remove complexity. The complexity in this problem comes from the edges of the triangle: How much of each edge should be part of the bisected shape? Different paths use different amounts of each edge, and there’s no obvious way to deduce the correct amounts. After making the ﬁgure symmetric by replicating the triangle into a hexagon, the edges become irrelevant. In the symmetric ﬁgure, the question simpliﬁes to ﬁnding the shortest path that encloses one-half of the hexagon.

### 4.3 Heat ﬂow

4 Symmetry                                                                                                                                                     25

Here is a metal sheet in the shape of a regular pentagon with the sides held at

```
                                                                                                                                                        ◦
                                                                                                                                                           10            10 ◦
```

ﬁxed temperatures. What is the temperature at the center of the pentagon?

```
                                                                                                                                                                  T =?
```

This problem is difﬁcult to solve analytically because heat ﬂow is described by

```
                                                                                                                                                   80                           10 ◦
```

a second-order partial differential equation, and this equation has simple solu­

tions only for a few simple boundaries. A pentagon is, alas, not one of those boundaries. Symmetry, however, makes the solution ﬂow. The symmetry operation is rotation because the pentagon’s orientation is an arbitrary choice. Nature, in the person of the heat equation, does not care how we point our coordinate systems. So these ﬁve orientations of the sheet behave the same:

```
           10
           ◦           10 ◦               10
                                          ◦           10 ◦               10
                                                                         ◦           10 ◦               10
                                                                                                        ◦           10 ◦               10
                                                                                                                                       ◦            10 ◦

                T =?                            ?                             ?                              ?                              ?
                                               T=                             T=                             T=                             T=
     80◦                      10 ◦   10
                                      ◦                      10 ◦   10
                                                                     ◦                      10 ◦   10
                                                                                                    ◦                      10 ◦   10
                                                                                                                                   ◦                       10 ◦

                10◦                             80◦                            80◦                            80◦                            80◦
```

Now stack these sheets (mentally), adding their temperatures that lie on top of each other to get the temperature proﬁle of a new metal sheet. For the new sheet, each edge has temperature

```
                                              Tedge = 80◦ + 10◦ + 10◦ + 10◦ + 10◦ = 120◦ .
```

Therefore, the entire sheet is at 120◦ . Since the symmetry operation is a rotation (by 72◦ ) about the center, the centers overlap when the plates are (mentally) stacked one on top of the other. Furtherfore, heat ﬂow is proportional to temperature difference – i.e. heat ﬂow is a linear process – so the temperature in the interior of the combined plate is the sum of the ﬁve corresponding interior temperatures. Since the stacked plate has a temperature of 120◦ throughout it, and the centers of the ﬁve subsheets align on top of each other, each center is at T = 120◦ /5 = 24◦ .

### 4.4 Looking forward

The next three chapters use this aspect of symmetry – ﬁnding and removing fake complexity – to develop three techniques: proportional reasoning, conservation, and dimensional analysis.

## 5. Proportional reasoning

Symmetry wrings out excess, irrelevant complexity, and proportional reasoning in one implementation of that philosophy. If an object moves with no forces on it (or if you walk steadily), then moving for twice as long means doubling the distance traveled. Having two changing quantities contributes complexity. However, the ratio distance/time, also known as the speed, is independent of the time. It is therefore simpler than distance or time. This conclusion is perhaps the simplest example of proportional reasoning, where the proportional statement is

```
                                         distance ∝ time.
```

Using symmetry has mitigated complexity. Here the symmetry operation is ‘change for how long the object move (or how long you walk)’. This operation should not change conclusions of an analysis. So, do the analysis using quantities that themselves are unchanged by this symmetry operation. One such quantity is the speed, which is why speed is such a useful quantity. Similarly, in random walks and diffusion problems, the mean-square distance traveled is proportional to the time travelled:

```
                                              x2 ∝ t.
```

So the interesting quantity is one that does not change when t changes:

```
                                                            x2
                                   interesting quantity ≡      .
                                                             t
```

This quantity is so important that it is given a name – the diffusion constant – and is tabulated in handbooks of material properties.

### 5.1 Period of a spring–mass system

As a ﬁrst example of proportional reasoning, here is one way to explain a famous result in physics: that the period of spring–mass system is independent of the amplitude.

```
   5 Proportional reasoning                                                                    27
```

So imagine a mass m connected to the wall by a spring with spring constant k. If disturbed, the mass oscillates. The period of the system is the time for

the mass to make a round trip through the equilibrium position.

```
                                                                                                    x
```

Extend the spring by a distance x0 ; this displacement is the amplitude. To see

how it affects the period, make an approximation, which will be an example of throwing away information (the topic of Part 3). The approximation is to pretend that the pendulum moves with a constant speed v. Then the period is

```
                                                       distance
                                                 T∼             ,
                                                       speed v
```

and the distance that the mass travels in one period is 4x0 . Ignore the factor of 4:

```
                                                           x0
                                                     T∼       .
                                                           v
```

Proportional reasoning helps us estimate v by an energy argument. The initial potential energy is PE ∼ kx20 or

```
                                                    PE ∝ x20 .
```

The maximum kinetic energy, which we use as a proxy for the typical kinetic energy, is the initial potential energy, so

```
                                                 KEtypical ∝ x20
                                      
   as well. The typical velocity is       KEtypical , so

                                                  vtypical ∝ x0 .
```

That result is great news because it means that the period is proportional to 1:

```
                                                       x0
                                                  T∝      = x00 .
                                                       x0
```

In other words, the period is independent of amplitude.

### 5.2 Mountain heights

The next example of proportional reasoning explains why mountains cannot become too high. Assume that all mountains are cubical and made of the same material. Making that assumption discards actual complexity, the topic of Part 3. However, it is a useful approximation. To see what happens if a mountain gets too large, estimate the pressure at the base of the mountain. Pressure is force divided by area, so estimate the force and the area. The area is the easier estimate. With the approximation that all mountains are cubical and made of the same kind of rock, the only parameter distinguishing one mountain from another is its side length l. The area of the base is then l2 .

Next estimate the force. It is proportional to the mass:

```
                                                   F ∝ m.
```

In other words, F/m is independent of mass, and that independence is why the proportionality F ∝ m is useful. The mass is proportional to l3 :

```
                                             m ∝ volume ∼ l3 .
```

In other words, m/l3 is independent of l; this independence is why the proportionality m ∝ l3 is useful. Therefore

```
                                                   F ∝ l3 .
```

The force and area results show that the pressure is proportional to l:

```
                                                                                                            ∝l
                                               F   l3
                                          p∼     ∝ 2 = l.
                                               A l                                                     force    area
                                                                                                       ∝ l3     ∝ l2
```

With a large-enough mountain, the pressure is larger than the maximum pressure that the rock can withstand. Then the rock ﬂows like a liquid, and the mountain

```
                                                                                                       mass
   cannot grow taller.                                                                                 ∝ l3
```

This estimate shows only that there is a maximum height but it does not compute the

```
                                                                                                      volume
```

maximum height. To do that next step requires estimating the strength of rock. Later

```
                                                                                                       ∝ l3
```

in this book when we estimate the strength of materials, I revisit this example. This estimate might look dubious also because of the assumption that mountains are cubical. Who has seen a cubical mountain? Try a reasonable alternative, that mountains are pyramidal with a square base of side l and a height l, having a 45◦ slope. Then the volume is l3 /3 instead of l3 but the factor of one-third does not affect the proportionality between force and length. Because of the factor of one-third, the maximum height will be higher for a pyramidal mountain than for a cubical mountain. However, there is again a maximum size (and height) of a mountain. In general, the argument for a maximum height requires only that all mountains are similar – are scaled versions of each other – and does not depend on the shape of the mountain.

### 5.3 Animal jump heights

We next use proportional reasoning to understand how high animals jump, as a function of their size. Do kangaroos jump higher than ﬂeas? We study a jump from standing (or from rest, for animals that do not stand); a running jump depends on different physics. This problem looks underspeciﬁed. The height depends on how much muscle an animal has, how efﬁcient the muscles are, what the animal’s shape is, and much else. The ﬁrst subsection introduces a simple model of jumping, and the second reﬁnes the model to consider physical effects neglected in the crude approximations.

```
     5 Proportional reasoning                                                                  29
```

5.3.1 Simple model

We want to determine only how jump height varies with body mass. Even this problem looks difﬁcult; the height still depends on muscle efﬁciency, and so on. Let’s see how far we get by just plowing along, and using symbols for the unknown quantities. Maybe all the unknowns cancel. We want an equation for the height h in the form h ∼ mβ , where m is the animal’s mass and β is the so-called scaling exponent. Jumping requires energy, which must be provided by muscles. This ﬁrst, simplest model equates the required energy to the energy supplied by the animal’s muscles. The required energy is the easier estimation: An animal of mass m jumping to a height

```
                                                                                                        h
```

h requires an energy Ejump ∝ mh. Because all animals feel the same gravity, this relation does not contain the gravitational acceleration g. You could include it in the equation,

```
                                                                                                    m
```

but it would just carry through the equations like unused baggage on a trip. The available energy is the harder estimation. To ﬁnd it, divide and conquer. It is the product of the muscle mass and of the energy per mass (the energy density) stored in muscle. To approximate the muscle mass, assume that a ﬁxed fraction of an animals mass is muscle, i.e. that this fraction is the same for all animals. If α is the fraction, then

```
                                            mmuscle ∼ αm

     or, as a proportionality,

                                            mmuscle ∝ m,
```

where the last step uses the assumption that all animals have the same α. For the energy per mass, assume again that all muscle tissues are the same: that they store the same energy per mass. If this energy per mass is E, then the available energy is

```
                                          Eavail ∼ Emmuscle

     or, as a proportionality,

                                          Eavail ∝ mmuscle ,
```

where this last step uses the assumption that all muscle has the same energy density E. Here is a tree that summarizes this model:

Now ﬁnish propagating toward the root. The available energy is

```
                                              Eavail ∝ m.
```

So an animal with three times the mass of another animal can store roughly three times the energy in its muscles, according to this simple model. Now compare the available and required energies to ﬁnd how the jump height as a function of mass. The available energy is

```
                                              Eavail ∝ m

     and the required energy is

                                            Erequired ∝ mh.
```

Equate these energies, which is an application of conservation of energy. Then mh ∝ m or

```
                                               h ∝ m0 .
```

In other words, all animals jump to the same height. The result, that all animals jump to the same height, seems surprising. Our intuition tells us that people should be able

```
     to jump higher than locusts. The graph shows jump heights                60
                                                                                                           Human
```

for animals of various sizes and shapes [source: Scaling: Why Animal Size is So Important [4, p. 178]. Here is the data:

```
                                                                              30           Click beetle

                                                                                    Flea
     Animal          Mass (g) Height (cm)
     Flea             5 · 10−4         20
     Click beetle     4 · 10−2         30                                     10
     Locust                  3         59                                          10−3         101
                                                                                           Mass (g)
     Human             7 · 104         60
```

The height varies almost not at all when compared to variation in mass, so our result is roughly correct! The mass varies more than eight orders of magnitude (a factor of 108 ), yet the jump height varies only by a factor of 3. The predicted scaling of constant h (h ∝ 1) is surprisingly accurate.

5.3.2 Power limits

Power production might also limit the jump height. In the preceding analysis, energy is the limiting reagent: The jump height is determined by the energy that an animal can store in its muscles. However, even if the animal can store enough energy to reach that height, the muscles might not be able to deliver the energy rapidly enough. This section presents a simple model for the limit due to limited power generation. Once again we’d like to ﬁnd out how power P scales (varies) with the size l Power is energy per time, so the power required to jump to a height h is

```
                               energy required to jump to height h
                        P∼                                           .
                             time over which the energy is delivered
```

The energy required is E ∼ mgh. The mass is m ∝ l3 . The gravitational acceleration is independent of l. And, in the energy-limited model, the height h is independent of l. Therefore E ∝ l3 . The delivery time is how long the animal is in contact with the ground, because only during contact can the ground exert a force on the animal. So, the animal crouches, extends upward, and ﬁnally leaves the ground. The contact time is the time during which the animal extends upward. Time is length over speed, so

```
                                                extension distance
                                 tdelivery ∼                       .
                                                 extension speed
```

The extension distance is roughly the animal’s size l. The extension speed is roughly the takeoff velocity. In the energy-limited model, the takeoff velocity is the same for all animals:

```
                                         vtakeoﬀ ∝ h1/2 ∝ l0 .

So

                                               tdelivery ∝ l.
```

The power required is P ∝ l3 /l = l2 . That proportionality is for the power itself, but a more interesting scaling is for the speciﬁc power: the power per mass. It is

```
                                           P   l2
                                             ∝ 3 = l−1 .
                                           m l
```

Ah, smaller animals need a higher speciﬁc power! A model for power limits is that all muscle can generate the same maximum power density (has the same maximum speciﬁc power). So a small-enough animal cannot jump to its energy-limited height. The animal can store enough energy in its muscles, but cannot release it quickly enough. More precisely, it cannot do so unless it ﬁnds an alternative method for releasing the energy. The click beetle, which is toward the small end in the preceding graph and data set, uses the following solution. It stores energy in its shell by bending the shell, and maintains the bending like a ratchet would (holding a structure motionless does require energy). This storage can happen slowly enough to avoid the speciﬁc-power limit, but when the beetle releases the shell and the shell snaps back to its resting position, the energy is released quickly enough for the beetle to rise to its energy-limited height. But that height is less than the height for locusts and humans. Indeed, the largest deviations from the constant-height result happen at the low-mass end, for ﬂeas and click beetles. To explain that discrepancy, the model needs to take into account another physical effect: drag.

### 5.4 Drag

This section section contains a proportional-reasoning analysis of drag – using a home experiment – and then applies the results to jumping ﬂeas.

5.4.1 Home experiment using falling cones

Here is a home experiment for understanding drag. Photocopy this page and cut out these templates, then tape the edges together to make a cone:

```
                                                                      cutout = 90◦

                                                                                     r = 2 in

                cutout = 90◦

                               r = 1 in
```

If you drop the small cone and the big cone, which falls faster? In particular, what is the ratio of their fall times tbig /tsmall ? The large cone, having a large area, feels more drag than the small cone does. On the other hand, the large cone has a higher driving force (its weight) than the small cone has. To decide whether the extra weight or the extra drag wins requires ﬁnding how drag depends on the parameters of the situation. However, ﬁnding the drag force is a very complicated calculation. The full calculation requires solving the Navier–Stokes equations:

```
                                                     ∂v    1
                                          (v·�)v +      = − �p + ν�2 v.
                                                     ∂t    ρ
```

And the difﬁculty does not end with this set of second-order, coupled, nonlinear partialdifferential equations. The full description of the situation includes a fourth equation, the continuity equation:

```
                                                      �·v = 0.
```

One imposes boundary conditions, which include the motion of the object and the requirement that no ﬂuid enters the object – and solves for the pressure p and the velocity gradient at the surface of the object. Integrating the pressure force and the shear force gives the drag force. In short, solving the equations analytically is difﬁcult. I could spend hundreds of pages describing the mathematics to solve them. Even then, solutions are known only in a few circumstances, for example a sphere or a cylinder moving slowly in a viscous ﬂuid or a sphere moving at any speed in an zero-viscosity ﬂuid. But an inviscid ﬂuid – what Feynman calls ‘dry water’ – is particularly irrelevant to real life since viscosity is the reason for drag, so an inviscid solution predicts zero drag! Proportional reasoning, supplemented with judicious lying, is a simple and quick alternative. The proportional-reasoning analysis imagines an object of cross-sectional area A moving through a ﬂuid at speed v for a distance d:

```
                           A                       volume ∼ Ad

                                                 distance ∼ d
```

The drag force is the energy consumed per distance. The energy is consumed by imparting kinetic energy to the ﬂuid, which viscosity eventually removes from the ﬂuid. The kinetic energy is mass times velocity squared. The mass disturbed is ρAd, where ρ is the ﬂuid density (here, the air density). The velocity imparted to the ﬂuid is roughly the velocity of the disturbance, which is v. So the kinetic energy imparted to the ﬂuid is ρAv2 d, making the drag force

```
                                                 F ∼ ρAv2 .
```

The analysis has a divide-and-conquer tree:

```
                                                                force ∼ E/d
                                                                    ρAv 2

                                     energy imparted, ∼ mv 2                  distance d
                                              ρAv 2 d

                               mass disturbed       velocity imparted
                                    ρAd                    ∼v

                           density      volume
                              ρ           Ad
```

The result that Fdrag ∼ ρv2 A is enough to predict the result of the cone experiment. The cones reach terminal velocity quickly – a result discussed later in the book in Part 3 – so the relevant quantity in ﬁnding the fall time is the terminal velocity. From the drag-force formula, the terminal velocity is

```
                                                         
                                                             Fdrag
                                                  v∼                 .
                                                              ρA

      Since the air density ρ is the same for the large and small cone, the relation simpliﬁes to
                                                    
                                                      Fdrag
                                                v∝          .
                                                        A
      The cross-sectional areas are easy to measure with a ruler, and the ratio between the small-
      and large-cone terminal velocities is even easier. The experiment is set up to make the drag
      force easy to measure: Since the cones fall at their respective terminal velocities, the drag
      force equals the weight. So
                                                    
                                                      W
                                                v∝        .
                                                       A
      Each cone’s weight is proportional to its cross-sectional area, because they are geometri­
      cally similar and made out of the same piece of paper. With W ∝ A, the terminal velocity
      becomes
                                                
                                                  A
                                           v∝        = A0 .
                                                  A
      In other words, the terminal velocity is independent of A, so the small and large cones
      should fall at the same speed. To test this prediction, I stood on a handy table and dropped
      the two cones. The fall lasted about two seconds, and they landed within 0.1 s of one an­
      other!

5.4.2 Effect of drag on ﬂeas jumping

      The drag force

                                                     F ∼ ρAv2

      affects the jumps of small animals more than it affects the jumps of people. A comparison
      of the energy required for the jump with the energy consumed by drag explains why.
      The energy that the animal requires to jump to a height h is mgh, if we use the gravitational
      potential energy at the top of the jump; or it is ∼ mv2 , if we use the kinetic energy at takeoff.
      The energy consumed by drag is

                                             Edrag ∼ ρv2 A ×h.
                                                     
                                                             Fdrag

      The ratio of these energies measures the importance of drag. The ratio is

                                          Edrag          ρv2 Ah ρAh
                                                     ∼         =    .
                                         Erequired        mv2    m

     5 Proportional reasoning                                                                   35
```

Since A is the cross-sectional area of the animal, Ah is the volume of air that it sweeps out in the jump, and ρAh is the mass of air swept out in the jump. So the relative importance of drag has a physical interpretation as a ratio of the mass of air displaced to the mass of the animal. To ﬁnd how this ratio depends on animal size, rewrite it in terms of the animal’s side length l. In terms of side length, A ∼ l2 and m ∝ l3 . What about the jump height h? The simplest analysis predicts that all animals have the same jump height, so h ∝ l0 . Therefore the numerator ρAh is ∝ l1 , the denominator m is ∝ l3 , and

```
                                              Edrag    l2
                                                     ∝ 3 = l−1 .
                                            Erequired l
```

So, small animals have a large ratio, meaning that drag affects the jumps of small animals more than it affects the jumps of large animals. The missing constant of proportionality means that we cannot say at what size an animal becomes ‘small’ for the purposes of drag. So the calculation so far cannot tell us whether ﬂeas are included among the small animals. The jump data, however, substitutes for the missing constant of proportionality. The ratio is

```
                                       Edrag          ρAh     ρl2 h
                                                  ∼       ∼            .
                                      Erequired        m    ρanimal l3

     It simpliﬁes to
                                              Edrag            ρ    h
                                                        ∼             .
                                            Erequired       ρanimal l
```

As a quick check, verify that the dimensions match. The left side is a ratio of energies, so it is dimensionless. The right side is the product of two dimensionless ratios, so it is also dimensionless. The dimensions match. Now put in numbers. A density of air is ρ ∼ 1 kg m−3 . The density of an animal is roughly the density of water, so ρanimal ∼ 103 kg m−3 . The typical jump height – which is where the data substitutes for the constant of proportionality – is 60 cm or roughly 1 m. A ﬂea’s length is about 1 mm or l ∼ 10−3 m. So

```
                                    Edrag          1 kg m−3  1m
                                              ∼                  ∼ 1.
                                  Erequired       10 kg m 10−3 m
                                                    3     −3
```

The ratio being unity means that if a ﬂea would jump to 60 cm, overcoming drag would require roughly as much as energy as would the jump itself in vacuum. Drag provides a plausible explanation for why ﬂeas do not jump as high as the typical height to which larger animals jump.

5.4.3 Cycling

This section discusses cycling as an example of how drag affects the performance of people as well as ﬂeas. Those results will be used in the analysis of swimming, the example of the next section. What is the world-record cycling speed? Before looking it up, predict it using armchair proportional reasoning. The ﬁrst task is to deﬁne the kind of world record. Let’s say that the cycling is on a level ground using a regular bicycle, although faster speeds are possible using special bicycles or going downhill. To estimate the speed, make a model of where the energy goes. It goes into rolling resistance, into friction in the chain and gears, and into drag. At low speeds, the rolling resistance and chain friction are probably important. But the importance of drag rises rapidly with speed, so at high-enough speeds, drag is the dominant consumer of energy. For simplicity, assume that drag is the only consumer of energy. The maximum speed happens when the power supplied by the rider equals the power consumed by drag. The problem therefore divides into two estimates: the power consumed by drag and the power that an athlete can supply. The drag power Pdrag is related to the drag force:

```
                                      Pdrag = Fdrag v ∼ ρv3 A.
```

It indeed rises rapidly with velocity, supporting the initial assumption that drag is the important effect at world-record speeds. Setting Pdrag = Pathlete gives

```
                                                             1/3
                                                  Pathlete
                                        vmax ∼
                                                   ρA
```

To estimate how much power an athlete can supply, I ran up one ﬂight of stairs leading from the MIT Inﬁnite Corridor. The Inﬁnite Corridor, being an old building, has spacious high ceilings, so the vertical climb is perhaps h ∼ 4 m (a typical house is 3 m per storey). Leaping up the stairs as fast as I could, I needed t ∼ 5 s for the climb. My mass is 60 kg, so my power output was

```
                                   potential energy supplied
                       Pauthor ∼
                                       time to deliver it
                                   mgh 60 kg × 10 m s−2 × 4 m
                                 =      ∼                     ∼ 500 W.
                                    t               5s
```

Pathlete should be higher than this peak power since most authors are not Olympic athletes. Fortunately I’d like to predict the endurance record. An Olympic athlete’s long-term power might well be comparable to my peak power. So I use Pathlete = 500 W. The remaining item is the cyclist’s cross-sectional area A. Divide the area into width and height. The width is a body width, perhaps 0.4 m. A racing cyclist crouches, so the height is maybe 1 m rather than a full 2 m. So A ∼ 0.4 m2 . Here is the tree that represents this analysis:

```
     5 Proportional reasoning                                                                          37
                                                                      vmax

                                       Pathlete ∼ Estairs /tstairs                Pdrag ∼ ρv 3 A

                                     Estairs                tstairs        ρ            v       A
                                     2400 J                   5s       1 kg m−3               0.4 m2

                             m         g            h
                            60 kg   10 m s−2       4m
```

Now combine the estimates to ﬁnd the maximum speed. Putting in numbers gives

```
                                                     1/3                                     1/3
                                        Pathlete                     500 W
                              vmax ∼                       ∼                                       .
                                         ρA                    1 kg m−3 × 0.4 m2
```

The cube root might suggest using a calculator. However, massaging the numbers simpliﬁes the arithmetic enough to do it mentally. If only the power were 400 W or, instead, if the area were 0.5 m! Therefore, in the words of Captain Jean-Luc Picard, ‘make it so’. The cube root becomes easy:

```
                                                            1/3
                                      400 W
                     vmax ∼∼                                      ∼ (1000 m3 s−3 )1/3 = 10 m s−1 .
                                1 kg m−3 × 0.4 m2
```

So the world record should be, if this analysis has any correct physics in it, around 10 m s−1 or 22 mph. The world one-hour record – where the contestant cycles as far as possible in one hour – is

### 49.7 km or 30.9 mi. The estimate based on drag is reasonable!

5.4.4 Swimming

The last section’s analysis of cycling helps predict the world-record speed for swimming. The last section showed that

```
                                                                        1/3
                                                      Pathlete
                                               vmax ∼                         .
                                                       ρA
```

To evaluate the maximum speed for swimming, one could put in a new ρ and A directly into that formula. However, that method replicates the work of multiplying, dividing, and cube-rooting the various values. Instead it is instructive to scale the numerical result for cycling by looking at how the maximum speed depends on the parameters of the situation. In other words, I’ll use the formula for vmax to work out the ratio vswimmer /vcyclist , and then use that ratio along with vcyclist to work out vswimmer . The speed vmax is

```
                                                                        1/3
                                                      Pathlete
                                               vmax ∼                         .
                                                       ρA
```

So the ratio of swimming and cycling speeds is

```
                                               1/3                    −1/3                   −1/3
                     vswimmer    Pswimmer                 ρswimmer               Aswimmer
                               ∼                     ×                       ×                      .
                      vcyclist    Pcyclist                 ρcyclist               Acyclist
```

Estimate each factor in turn. The ﬁrst factor accounts for the relative athletic prowess of swimmers and cyclists. Let’s assume that they generate equal amounts of power; then the ﬁrst factor is unity. The second factor accounts for the differing density of the mediums in which each athlete moves. Roughly, water is 1000 times denser than air. So the second factor contributes a factor of 0.1 to the speed ratio. If the only factors were the ﬁrst two, then the swimming world record would be about 1 m s−1 . Let’s compare with reality. The actual world record for a 1500-m freestyle (in a 50-m pool) is 14m34.56s set in July 2001 by Grant Hackett. That speed is 1.713 m s−1 , signiﬁcantly higher than the prediction of 1 m s−1 . The third factor comes to the rescue by accounting for the relative proﬁle of a cyclist and a swimmer. A swimmer and a cyclist probably have the same width, but the swimmer’s height (depth in the water) is perhaps one-sixth that of a crouched cyclist. So the third factor contributes 61/3 to the predicted speed, making it 1.8 m s−1 . This prediction is close to the actual record, closer to reality than one might expect given the approximations in the physics, the values, and the arithmetic. However, the accuracy is a result of the form of the estimate, that the maximum speed is proportional to the cube root of the athlete’s power and the inverse cube root of the cross-sectional area. Errors in either the power or area get compressed by the cube root. For example, the estimate of 500 W might easily be in error by a factor of 2 in either direction. The resulting error in the maximum speed is 21/3 or 1.25, an error of only 25%. The cross-sectional area of a swimmer might be in error by a factor of 2 as well, and this mistake would contribute only a 25% error to the maximum speed. [With luck, the two errors would cancel!]

5.4.5 Flying

In the next example, I scale the drag formula to estimate the fuel efﬁciency of a jumbo jet. Rather than estimating the actual fuel consumption, which would produce a large, meaningless number, it is more instructive to estimate the relative fuel efﬁciency of a plane and a car. Assume that jet fuel goes mostly to ﬁghting drag. This assumption is not quite right, so at the end I’ll discuss it and other troubles in the analysis. The next step is to assume that the drag force for a plane is given by the same formula as for a car:

```
                                                Fdrag ∼ ρv2 A.
```

Then the ratio of energy consumed in travelling a distance d is

```
                              Eplane       ρup−high        vplane 2       Aplane    d
                                       ∼              ×               ×            × .
                               Ecar         ρlow            vcar          Acar      d

   5 Proportional reasoning                                                                      39
```

Estimate each factor in turn. The ﬁrst factor accounts for the lower air density at a plane’s cruising altitude. At 10 km, the density is roughly one-third of the sea-level density, so the ﬁrst factor contributes 1/3. The second factor accounts for the faster speed of a plane. Perhaps vplane ∼ 600 mph and vcar ∼ 60 mph, so the second factor contributes a factor of 100. The third factor accounts for the greater cross-sectional area of the plane. As a reasonable estimate

```
                                       Aplane ∼ 6 m × 6 m = 36 m2 ,

   whereas

                                       Acar ∼ 2 m × 1.5 m = 3 m2 ,
```

so the third factor contributes a factor of 12. The fourth factor contributes unity, since we are analyzing the plane and car making the same trip (New York to Los Angeles, say). The result of the four factors is

```
                                       Eplane       1
                                                ∼     × 100 × 12 ∼ 400.
                                        Ecar        3
```

A plane looks incredibly inefﬁcient. But I neglected the number of people. A jumbo jet takes carries 400 people; a typical car, at least in California, carries one person. So the plane and car come out equal! This analysis leaves out many effects. First, jet fuel is used to generate lift as well as to ﬁght drag. However, as a later analysis will show, the energy consumed in generating lift is comparable to the energy consumed in ﬁghting drag. Second, a plane is more streamlined than a car. Therefore the missing constant in the drag force Fdrag ∼ ρv2 A is smaller for a plane than for a car. our crude analysis of drag has not included this effect. Fortunately this error compensates, or perhaps overcompensates, for the error in neglecting lift.

### 5.5 Analysis of algorithms

Proportional reasoning is the basis of an entire subject of the analysis of algorithms, a core part of computer science. How fast does an algorithm run? How much space does it require? A proportional-reasoning analysis helps you decide which algorithms to use. This section discusses these decisions using the problem of how to square very large numbers. Squaring numbers is a special case of multiplication, but the algebra is simpler for squaring than for multiplying since having only one number as the input means there are fewer variables in the analysis. Here is a divide-and-conquer version of the standard school multiplication algorithm.

## 6. Box models and conservation

### 6.1 Cube solitaire

```
   Here is a game of solitaire that illustrates the theme of this chapter. The following       0
   cube starts in the conﬁguration in the margin; the goal is to make all vertices be      0
```

multiples of three simultaneously. The moves are all of the same form: Pick any edge and increment its two vertices by one. For example, if I pick the bottom

```
                                                                                               0       0
   edge of the front face, then the bottom edge of the back face, the conﬁguration         1
```

becomes the ﬁrst one in this series, then the second one:

```
        0         0       0         0
    0         0       0         0

        0         0       1         1
   2         1        2         1
```

Alas, neither conﬁguration wins the game. Can I win the cube game? If I can win, what is a sequence of moves ends in all vertices being multiples of 3? If I cannot win, how can that negative result be proved? Brute force – trying lots of possibilities – looks overwhelming. Each move requires choosing one of 12 edges, so there are 1210 sequences of ten moves. That number is an overestimate because the order of the moves does not affect the ﬁnal state. I could push that line of reasoning by ﬁguring out how many possibilities there are, and how to list and check them if the number is not too large. But that approach is speciﬁc to this problem and unlikely to generalize to other problems.

```
   Instead of that speciﬁc approach, make the generic observation that this problem is         0
```

difﬁcult because each move offers many choices. The problem would be simpler with fewer edges: for example, if the cube were a square. Can this square be turned into one where the four vertices are multiples of 3? This problem is not the original

```
   problem, but solving it might teach me enough to solve the cube. This hope motivates        1
```

the following advice: When the going gets tough, the tough lower their standards.

The square is easier to analyze than is the cube, but standards can be lowered still more by analyzing the one-dimensional analog, a line. Having only one edge means that there is only one move: incrementing the top and bottom vertices. The vertices start with a difference of one, and continue with that difference. So they cannot be multiples of 3 simultaneously. In symbols: a − b = 1. If all vertices were multiples of 3, then a − b would also be a multiple of 3. Since a − b = 1, it is also true that

```
                                        a − b ≡ 1 (mod 3),
```

where the mathematical notation x ≡ y (mod 3) means that x and y have the same remainder (the same modulus) when dividing by 3. In this one-dimensional version of the game, the quantity a − b is an invariant: It is unchanged after the only move of increasing each vertex on an edge. Perhaps a similar invariant exists in the two-dimensional version of the game. d = 0 Here is the square with variables to track the number at each vertex. The onedimensional invariant a − b is sometimes an invariant for the square. If my move uses the bottom edge, then a and b increase by 1, so a − b does not change. If my move uses the top edge, then a and b are individually unchanged so a − b is again a = 1 unchanged. However, if my move uses the left or right edge, then either a or b changes without a compensating change in the other variable. The difference d − c has a similar behavior in that it is changed by some of the moves. Fortunately, even when a − b and d − c change, they change in the same way. A move using the left edge increments a − b and d − c; a move using the right edge decrements a − b and d − c. So (a − b) − (d − c) is invariant! Therefore for the square,

```
                                    a − b + c − d ≡ 1 (mod 3),
```

so it is impossible to get all vertices to be multiples of 3.

```
The original, three-dimensional solitaire game is also likely to be impossible         h=0
to win. The correct invariant shows this impossibility. The quantity a − b + c −     d=0
```

d + f − g + h − e generalizes the invariant for the square, and it is preserved by all 12 moves. So

```
                                                                                       e=0          f =0

                                                                                     a=1          b=0
                     a − b + c − d + f − g + h − e ≡ 1 (mod 3),
```

which shows that all vertices cannot be made multiples of 3 simultaneously. Invariants – quantities that remain unchanged – are a powerful tool for solving problems. Physics problems are also solitaire games, and invariants (conserved quantities) are essential in physics. Here is an example: In a frictionless world, design a roller-coaster track so that an unpowered roller coaster, starting from rest, rises above its starting height. Perhaps a clever combination of loops and curves could make it happen. The rules of the physics game are that the roller coaster’s position is determined by Newton’s second law of motion F = ma, where the forces on the roller coaster are its weight and

```
      the contact force from the track. In choosing the shape of the track, you affect the contact
      force on the roller coaster, and thereby its acceleration, velocity, and position. There are an
      inﬁnity of possible tracks, and we do not want to analyze each one to ﬁnd the forces and
      acceleration. An invariant, energy, simpliﬁes the analysis. No matter what tricks the track
      does, the kinetic plus potential energy
                                                1 2
                                                  mv + mgh
                                                2
      is constant. The roller coaster starts with v = 0 and height hstart ; it can never rise above
      that height without violating the constancy of the energy. The invariant – the conserved
      quantity – solves the problem in one step, avoiding an endless analysis of an inﬁnity of
      possible paths.
      The moral of this section is: When there is change, look for what does not change.
```

### 6.2 Flight

```
      How far can birds and planes ﬂy? The theory of ﬂight is difﬁcult and involves vortices,
      Bernoulli’s principle, streamlines, and much else. This section offers an alternative ap­
      proach: use conservation estimate the energy required to generate lift, then minimize the
      lift and drag contributions to the energy to ﬁnd the minimum-energy way to make a trip.

6.2.1 Lift

      Instead of wading into the swamp of vortices, study what does not change. In this case, the
      vertical component of the plane’s momentum does not change while it cruises at constant
      altitude.
      Because of momentum conservation, a plane must deﬂect air downward. If it did not, grav­
      ity would pull the plane into the ground. By deﬂecting air downwards – which generates
      lift – the plane gets a compensating, upward recoil. Finding the necessary recoil leads to
      ﬁnding the energy required to produce it.
      Imagine a journey of distance s. I calculate the energy to produce lift in three steps:

      1. How much air is deﬂected downward?
      2. How fast must that mass be deﬂected downward in order to give the plane the needed
         recoil?
      3. How much kinetic energy is imparted to that air?

      The plane is moving forward at speed v, and it deﬂects air over an area L2 where L is the
      wingspan. Why this area L2 , rather than the cross-sectional area, is subtle. The reason is that
      the wings disturb the ﬂow over a distance comparable to their span (the longest length). So
      when the plane travels a distance s, it deﬂects a mass of air

                                                mair ∼ ρL2 s.

     6 Box models and conservation                                                               43
```

The downward speed imparted to that mass must take away enough momentum to compensate for the downward momentum imparted by gravity. Traveling a distance s takes time s/v, in which time gravity imparts a downward momentum Mgs/v to the plane. Therefore

```
                                                            Mgs
                                             mair vdown ∼
                                                             v
     so
                                               Mgs    Mgs   Mg
                                     vdown ∼        ∼     =     .
                                               vmair ρvL s ρvL2
                                                        2
```

The distance s divides out, which is a good sign: The downward velocity of the air should not depend on an arbitrarily chosen distance! The kinetic energy required to send that much air downwards is mair v2down . That energy factors into (mair vdown )vdown , so

```
                                                         Mgs Mg    (Mg)2
                            Elift ∼ mair vdown vdown ∼           =        s.
                                                      v ρvL2   ρv2 L2
                                     Mgs/v
                                                            
                                                                vdown
```

Check the dimensions: The numerator is a squared force since Mg is a force, and the denominator is a force, so the expression is a force times the distance s. So the result is an energy. Interestingly, the energy to produce lift decreases with increasing speed. Here is a scaling argument to make that result plausible. Imagine doubling the speed of the plane. The fast plane makes the journey in one-half the time of the original plane. Gravity has only onehalf the time to pull the plane down, so the plane needs only one-half the recoil to stay aloft. Since the same mass of air is being deﬂected downward but with half the total recoil (momentum), the necessary downward velocity is a factor of 2 lower for the fast plane than for the slow plane. This factor of 2 in speed lowers the energy by a factor of 4, in accordance with the v−2 in Elift .

6.2.2 Optimization including drag

The energy required to ﬂy includes the energy to generate lift and to ﬁght drag. I’ll add the lift and drag energies, and choose the speed that minimizes the sum. The energy to ﬁght drag is the drag force times the distance. The drag force is usually written as

```
                                               Fdrag ∼ ρv2 A,
```

where A is the cross-sectional area. The missing dimensionless constant is cd /2:

```
                                                    1
                                             Fdrag = cd ρv2 A,
                                                    2
```

where cd is the drag coefﬁcient. However, to simplify comparing the energies required for lift and drag, I instead write the drag force as

```
                                        Fdrag = Cρv2 L2 ,
```

where C is a modiﬁed drag coefﬁcient, where the drag is measured relative to the squared wingspan rather than to the cross-sectional area. For most ﬂying objects, the squared wingspan is much larger than the cross-sectional area, so C is much smaller than cd . With that form for Fdrag , the drag energy is

```
                                        Edrag = Cρv2 L2 s,

and the total energy to ﬂy is

                                        (Mg)2
                                   E∼          s + Cρv2 L2 s .
                                        ρv L
                                          2  2
                                                     
                                                 E drag
                                           Elift
```

A sketch of the total energy versus velocity shows interesting features. At low speeds, lift is the dominant consumer because

```
                                                                                       Edrag ∝ v 2
        −2
```

of its v dependence. At high speeds, drag is the dominant

```
                                                                         Etotal
```

consumer because of its v2 dependence. In between these extremes is an optimum speed voptimum : the speed that minimizes E the energy consumption for a ﬁxed journey distance s. Going faster or slower than the optimum speed means consuming more energy. That extra consumption cannot always be avoided. A plane is designed so that its cruising speed is its minimum-energy speed. So at takeoff and landing, when its speed is much less than the minimum-energy speed, a plane requires a lot of power to stay aloft, which is one reason that the engines are so loud at takeoff and landing (another reason is probably that the engine noise reﬂects off the ground and back to the plane). The constraint, or assumption, that a plane travels at the minimum-energy speed simpliﬁes the expression for the total energy. At the minimum-energy speed, the drag and lift energies are equal. So

```
                                      (Mg)2
                                             s ∼ Cρv2 L2 s,
                                      ρv2 L2
or

                                       Mg ∼ C1/2 ρv2 L2 .
```

This constraint simpliﬁes the total energy. Instead of simplifying the sum, simplify just the drag, which neglects only a factor of 2 since drag and lift are roughly equal at the minimum-energy speed. So

```
     6 Box models and conservation                                                                  45

                                     E ∼ Edrag ∼ Cρv2 L2 s ∼ C1/2 Mgs.
```

This result depends in reasonable ways upon M, g, C, and s. First, lift overcomes gravity, and gravity produces the plane’s weight Mg. So Mg should show up in the energy, and the energy should, and does, increase when Mg increases. Second, a streamlined plane should use less energy than a bluff, blocky plane, so the energy should, and does, increase as the modiﬁed drag coefﬁcient C increases. Third, since the ﬂight is at a constant speed, the energy should be, and is, proportional to the distance traveled s.

6.2.3 How the maximum range depends on size

Before calculating a range for a particular plane or bird, evaluate the scaling: How does the range depend on the size of the plane? As for the mountain-height analysis (Section 5.2), assume that all planes are geometrically similar (have the same shape) and therefore differ only in size. Since the energy required to ﬂy a distance s is E ∼ C1/2 Mgs, a tank of fuel gives a range of

```
                                                         Etank
                                                   s∼           .
                                                        C1/2 Mg
```

Let β be the fuel fraction: the fraction of the plane’s mass taken up by fuel. Then Mβ is the fuel mass, and MβE is the energy contained in the fuel, where E is the energy density (energy per mass) of the fuel. With that notation, Etank ∼ MβE and

```
                                                    MβE   βE
                                             s∼     1/2
                                                        = 1/2 .
                                                   C Mg C g
```

Since all planes, at least in this analysis, have the same shape, their modiﬁed drag coefﬁcient C is also the same. And all planes face the same gravitational ﬁeld strength g. So the denominator is the same for all planes. The numerator contains β and E. Both parameters are the same for all planes. So the numerator is the same for all planes. Therefore

```
                                                        s ∝ 1.
```

All planes can ﬂy the same distance! Even more surprising is to apply this reasoning to migrating birds. Here is the ratio of ranges:

```
                                   splane        βplane Eplane Cplane −1/2
                                             ∼                               .
                                     sbird       βbird Ebird        Cbird
```

Take the factors in turn. First, the fuel fraction βplane is perhaps 0.3 or 0.4. The fuel fraction βbird is probably similar: A well-fed bird having fed all summer is perhaps 30 or 40% fat. So βplane /βbird ∼ 1. Second, jet fuel energy density is similar to fat’s energy density, and plane engines and animal metabolism are comparably efﬁcient (about 25%). So Eplane /Ebird ∼ 1. Finally, a bird has a similar shape to a plane – it is not a great approximation, but it has the virtue of simplicity. So Cbird /Cplane ∼ 1.

Therefore, planes and well-fed, migrating birds should have the same maximum range! Let’s check. The longest known nonstop ﬂight by an animal is 11, 570 km, made by a bartailed godwit from Alaska to New Zealand (tracked by satellite). The maximum range for a 747-400 is 13, 450 km, only slightly longer than the godwit’s range.

6.2.4 Explicit computations

To get an explicit range, not only how the range scales with size, estimate the fuel fraction β, the energy density E, and the drag coefﬁcient C. For the fuel fraction I’ll guess β ∼ 0.4. For E, look at the nutrition label on the back of a pack of butter. Butter is almost all fat, and one serving of 11 g provides 100 Cal (those are ‘big calories’). So its energy density is 9 kcal g−1 . In metric units, it is 4 · 107 J kg−1 . Including a typical engine efﬁciency of one-fourth gives

```
                                              E ∼ 107 J kg−1 .
```

The modiﬁed drag coefﬁcient needs converting from easily available data. According to Boeing, a 747 has a drag coefﬁcient of C ≈ 0.022, where this coefﬁcient is measured using the wing area:

```
                                                 1
                                          Fdrag = C Awing ρv2 .
                                                 2
```

Alas, this formula is a third convention for drag coefﬁcients, depending on whether the drag is referenced to the cross-sectional area A, wing area Awing , or squared wingspan L2 . It is easy to convert between the deﬁnitions. Just equate the standard deﬁnition

```
                                                 1
                                          Fdrag = C Awing ρv2 .
                                                 2
     to our deﬁnition

                                              Fdrag = CL2 ρv2

     to get
                                              1 Awing  1 l 
                                         C=          C =    C,
                                              2 L2       2L
```

since Awing = Ll where l is the wing width. For a 747, l ∼ 10 m and L ∼ 60 m, so C ∼ 1/600. Combine the values to ﬁnd the range:

```
                              βE    0.4 × 107 J kg−1
                          s ∼ 1/2 ∼                    ∼ 107 m = 104 km.
                             C g (1/600)1/2 × 10 m s−2
```

The maximum range of a 747-400 is 13, 450 km. The maximum known nonstop ﬂight by a bird – indeed, by any animal – is 11, 570 km: A female bar-tailed godwit tracked by satellite migrated between Alaska and New Zealand. The approximate analysis of the range is unreasonably accurate. Next I estimate the minimum-energy speed and compare it to the cruising speed of a 747. The sum of drag and lift energies is a minimum when the speed is given by

```
                                      Mg ∼ C1/2 ρv2 L2 .

The speed is
                                                    1/2
                                           Mg
                                      v ∼ 1/2 2           .
                                          C ρL
```

A fully loaded 747 has M ∼ 4 · 105 kg. The drag coefﬁcient is again C ∼ 1/600, the wingspan is L ∼ 60 m, and the air density up high is ρ ∼ 0.5 kg m−3 . So

```
                                                                    1/2
                                       4 · 105 kg × 10 m s−2
                       v∼                                              .
                               (1/600)1/2 × 0.5 kg m−3 × 3.6 · 103 m2
                                   √
```

Do the arithmetic mentally. The 1/600 in the denominator becomes a 25 in the numerator. Combined with the 4 · 105 , it becomes 107 . Including the 10 from g, the numerator is 108 and the denominator is roughly 2 · 103 , so

```
                                 1/2
                         1
                    v∼     · 105     m s−1 = 51/2 × 100 m s−1 ∼ 220 m s−1 .
                         2
```

That speed is roughly 500 mph, reasonably close to the 747’s maximum speed of 608 mph.

## 7. Dimensions

The next way to eliminate spurious complexity is the method of dimensional analysis or dimensionless groups. The following mathematical problem shows how dimensionless groups are, like proportional reasoning and conservation laws, a form of symmetry reasoning. The problem is to expand the polynomial (a + b + c)3 into its numerous terms. The school-algebra method is to multiply a + b + c by a + b + c and then multiply the result by a + b + c. The school-algebra method is messy prone to mistakes, but symmetry comes to the rescue. The factor a + b + c is unchanged if a an b, if a and c, or if b and c are swapped. Indeed, any permutation of a, b, and c leaves a + b + c unchanged and leaves (a + b + c)3 unchanged. Therefore, the product can – and should be – built using invariant combinations of a, b, and c: combinations that are unchanged by permuting a, b, and c. The product contains a3 , but a3 alone is not invariant to a permutation. The invariant version of a3 is a3 + b3 + c3 , which is one component of the product. The product also contains terms like a2 b, which again is not invariant. The analogous invariant sum comes from adding all possible permutations of a2 b:

```
                              (a2 b + ab2 ) + (a2 c + ac2 ) + (b2 c + bc2 ).
```

The third type of term is abc. So the product has the form

```
         (a + b + c)3 = A(a3 + b3 + c3 ) + B(a2 b + ab2 + a2 c + ac2 + b2 c + bc2 ) + C(abc),
```

where A, B, and C are for-the-moment-unknown constants. Here is one way to evaluate the constants. Set a = 1, b = c = 0. Then the equation reduces to

```
                                              13 = A · 1 3 ,
```

so A = 1. To get another relation, set a = b = c = 1. Then, using A = 1, the equation reduces to

```
                                          27 = 3 + 6B + C.

   7 Dimensions                                                                                   49
```

To ﬁnd C, notice that there are six ways to get an abc factor. So C = 6 and then B = 3. Thus

```
              (a + b + c)3 = (a3 + b3 + c3 ) + 3(a2 b + ab2 + a2 c + ac2 + b2 c + bc2 ) + 6abc.
```

This symmetry solution has several merits. First, it is less prone to mistakes than is multiplying by brute force. Second, it produces the answer in a meaningful, low-entropy form. The chunks in the solution – the terms a3 + b3 + c3 and a2 b + ab2 + a2 c + ac2 + b2 c + bc2 and abc – each obey the symmetry that nothing important changes if you permute a, b, and c. Rather than using a brute-force method and then doing hard work to turn the solution into a meaningful form, use symmetry reasoning: Whenever possible, work with quantities that obey the symmetries of the problem. This chapter shows how this idea leads naturally to dimensionless groups, the fundamental idea of dimensional analysis.

### 7.1 Power of multinationals

The ﬁrst example shows what happens when people take no notice of dimensions. Critics of globalization often make this argument:

```
      In Nigeria, a relatively economically strong country, the GDP [gross domestic prod­
      uct] is $99 billion. The net worth of Exxon is $119 billion. ‘When multinationals have
      a net worth higher than the GDP of the country in which they operate, what kind of
      power relationship are we talking about?’ asks Laura Morosini. [Source: ‘Impunity
      for Multinationals’, ATTAC, 11 Sept 2002, [url:nigeria-argument], retrieved 11
      Sept 2006]
```

Before reading further, try to ﬁnd the most egregious fault in the comparison between Exxon and Nigeria. It’s a competitive ﬁeld, but one fault stands out. The comparison between Exxon and Nigeria has many problems. First, the comparison exaggerates Exxon’s power by using its worldwide assets (net worth) rather than its assets only in Nigeria. On the other hand, Exxon can use its full international power when negotiating with Nigeria, so perhaps the worldwide assets are a fair basis for comparison. A more serious, and less debatable, problem is the comparison with GDP, or gross domestic product. To see the problem, look at the ingredients in how GDP is usually measured: as dollars per year. The $99 billion for Nigeria’s GDP is shorthand for $99 billion per year. A year is an astronomical time, and its use in an economic measurement is arbitrary. Economic ﬂows, which are a social phenomenon, should not care about how long the earth requires to travel around the sun. Suppose instead that the decade was the chosen unit of time in measuring the GDP. Then Nigeria’s GDP would be roughly $1 trillion per decade (assuming that the $99 billion per year value held steady) and would be reported as $1 trillion. Now Nigeria towers over the puny Exxon whose assets are a mere one-tenth of this ﬁgure.

To produce the opposite conclusion, just measure GDP in units of dollars per week: Nigeria’s GDP becomes $2 billion per week. Now puny Nigeria stands helpless before the might of Exxon, 50-fold larger than Nigeria. Either conclusion about the relative powers can be produced merely by changing the units. This arbitrariness indicates that the comparison is bogus. The ﬂaw in the comparison is the theme of this chapter. Assets, or net worth, are an amount of money – money is its dimensions – and are typically measured in units of dollars. GDP is deﬁned as the total goods and services sold in one year. It is a rate and has dimensions of money per time; its typical units are dollars per year. Comparing assets to GDP means comparing money to money per time. Because the dimensions of these two quantities are not the same, the comparison is nonsense! A similarly ﬂawed comparison is to compare length per time (speed) with length. Listen how ridiculous it sounds: ‘I walk 1.5 meters per second, much smaller than the Empire State building in New York, which is 300 meters high.’ To produce the opposite conclusion, measure time in hours: ‘I walk 5000 meters per hour, much larger than the Empire State building at only 300 meters.’ Nonsense all around! This example illustrates several ideas:

- Dimensions versus units. Dimensions are general and generic, such as money per time or
length per time. Units are the instantiation of dimensions in a system of measurement. The most complete system of measurement is the System International (SI), where the unit of mass is the kilogram, the unit of time the second, and the unit of length the meter. Other examples of units are dollars per year or kilometers per year.

- Necessary condition for a valid comparison. In a valid comparison, the dimensions of the
compared objects be identical. Do not compare apples to oranges (except in questions of taste, like ‘I prefer apples to oranges.’)

- Rubbish abounds. There’s lots of rubbish out there, so keep your eyes open for it!
- Bad argument, ﬁne conclusion. I agree with the conclusion of the article, that large oil
companies exert massive power over poor countries. However, as a physicist I am embarrassed by the reasoning. This example teaches me a valuable lesson about theorems and proofs: judge the proof not just the theorem. Even if you disagree with the conclusion, remember the general lesson that a correct conclusion does not validate a dubious argument.

### 7.2 Pyramid volume

The last example showed the value of dimensions in economics. The next example shows that dimensions are also useful in mathematics. What is the volume of this

```
                                                                                             h
```

square-based pyramid? Here are several choices:

```
                                                                                                 b
      1
   1. bh                                                                                     b
      3
```

2. b3 + h2

3. b4 /h 4. bh2

Let’s take the choices in turn. The ﬁrst choice, bh/3, has dimensions of area rather than volume. So it cannot be right. The second choice, b3 + h2 , begins with a volume in the b3 term but falls apart with the h2 , which has dimensions of area. Since it adds an area to a volume – the crime of dimension mixing – it cannot be right. The third choice, b4 /h, has dimensions of volume, so it might be correct. It even increases as b increases, which is a good sign. However, the volume should increase as h increases – a proportional-reasoning argument – whereas this choice indicates that the volume decreases as h increases! So it cannot be right. The ﬁnal choice, bh2 , has correct dimensions and increases as h or b increases. Does it increase by the right amounts? Imagine drilling into the pyramid from the top and dividing it into thin cores or volume elements. If the height of the pyramid doubles, then each vertical volume element doubles in volume; so the volume of the pyramid should double. In symbols, V ∝ h. But bh2 quadruples when h doubles, so that choice cannot be right. The requirement that V ∝ h together with the requirement that V have dimensions of length cubed means that the missing item in V ∝ h is an area. The only way to make an area from b is to make b2 perhaps times a dimensionless constant. So

```
                                         V ∼ hb2 .
```

The missing dimensionless constant is hidden in the twiddle ∼ sign. Alternatively, the ratio V/hb2 is dimensionless. This method of deducing the volume requires remembering hardly any arbitrary data. It requires these ingredients:

1. Using vertical volume elements to ﬁnd out that V ∝ h.
2. Using dimensions along with V ∝ h to show that V ∼ hb2 .
3. Remembering the correct dimensionless constant.
The ﬁrst two steps are logic and do not require arbitrary data. Instead they use reasoning methods that you use elsewhere (so there’s no marginal cost to remember them). The third step requires seemingly arbitrary data. However, in Chapter 8 on special cases, I’ll show you how to determine the constant elegantly without even needing an integral. Then the volume requires no memory. Arbitrary data is, by deﬁnition, impossible to compress. Dimensions, and more generally our techniques for handling complexity, are a form of data compression or entropy reduction [5]. One way to look at learning is as data compression. So dimensions, and our other techniques, enhance learning. There’s an old saying: Tell the truth; there’s less to remember. The similar moral here is: Use dimensions (and proportional reasoning); there’s less to remember!

### 7.3 Dimensionless groups

Dimensionless ratios are useful. For example, in the oil example, the ratio of the two quantities has dimensions; in that case, the dimensions of the ratio are time (or one over time). If the authors of the article had used a dimensionless ratio, they might have made a valid comparison. This section explains why dimensionless ratios are the only quantities that you need to think about; in other words, that there is no need to think about quantities with dimensions. To see why, take a concrete example: computing the energy E to produce lift as a function of distance traveled s, plane speed v, air density ρ, wingspan L, plane mass m, and strength of gravity g. Any true statement about these variables looks like

```
                                      mess   +   mess   =   mess    ,
```

where the various messes mean ’a horrible combination of E, s, v, ρ, L, and m. As horrible as that true statement is, it permits the following rewriting: Divide each term by the ﬁrst one (the triangle). Then

```
                                                 mess        mess
                                     mess
                                             +          =               ,
                                     mess        mess        mess
```

The ﬁrst ratio is 1, which has no dimensions. Without knowing the individual messes, we don’t know the second ratio; but it has no dimensions because it is being added to the ﬁrst ratio. Similarly, the third ratio, which is on the right side, also has no dimensions. So the rewritten expression is dimensionless. Nothing in the rewriting depended on the particular form of the true statement, except that each term has the same dimensions. Therefore, any true statement can be rewritten in dimensionless form. Dimensionless forms are made from dimensionless ratios, so all you need are dimensionless ratios, and you can do all your thinking with them. Here is a familiar example to show how this change simpliﬁes your thinking. This example uses familiar physics so that you can concentrate on the new idea of dimensionless ratios. The problem is to ﬁnd the period of an oscillating spring–mass system given an initial displacement x0 , then allowed to oscillate freely. Section 5.1 gave

a proportional-reasoning analysis of this system. The relevant variables that

```
                                                                                                   x
```

determine the period T are mass m, spring constant k, and amplitude x0 . Those three variables completely describe the system, so any true statement about period needs only those variables.

```
Since any true statement can be written in dimensionless form, Var        Dim
the next step is to ﬁnd all dimensionless forms that can be       T        T
constructed from T, m, k, and x0 . A table of dimensions is       m        M
helpful. The only tricky entry is the dimensions of a spring      k      MT  −2
constant. Since the force from the spring is F = kx, where x      x0       L
```

is the displacement, the dimensions of a spring constant are the dimensions of force divided by the dimensions of x. It is convenient to have a notation for the concept of ‘the dimensions of’. In that notation,

```
                                                 [F]
                                         [k] =       ,
                                                 [x]
              
```

where quantity means the dimensions of the quantity. Since [F] = MLT−2 and [x] = L,

```
                                       [k] = MT−2 ,
```

which is the entry in the table. These quantities combine into many – inﬁnitely many – dimensionless combinations or groups:

```
                                                 25
                               kT2 m    kT2                 m
                                  ,   ,               ,π       , ,....
                                m kT2    m                 kT2
```

The groups are redundant. You can construct them from only one group. In fancy terms, all the dimensionless groups are formed from one independent dimensionless group. What combination to use for that one group is up to you, but you need only one group. I like kT2 /m. So any true statement about the period can be written just using kT2 /m. That requirement limits the possible statements to

```
                                         kT2
                                             = C,
                                          m
```

where C is a dimensionless constant. This form has two important consequences:

1. The amplitude x0 does not affect the period. This independence is also known as simple
harmonic motion. The analysis in Section 5.1 gave an approximate argument for why the period should be independent of the amplitude. So that approximate argument turns out to be an exact argument.

2. The constant C is independent of k and m. So I can measure it for one spring–mass
system and know it for all spring–mass systems, no matter the mass or spring constant. The constant is a universal constant.

The requirement that dimensions be valid has simpliﬁed the analysis of the spring–mass system. Without using dimensions, the problem would be to ﬁnd (or measure) the threevariable function f that connects m, k, and x0 to the period:

```
                                      T = f (m, k, x0 ).
```

Whereas using dimensions reveals that the problem is simpler: to ﬁnd the function h such that

```
                                                kT2
                                                    = h().
                                                 m
```

Here h() means a function of no variables. Why no variables? Because the right side contains all the other quantities on which kT2 /m could depend. However, dimensional analysis says that the variables appear only through the combination kT2 /m, which is already on the left side. So no variables remain to be put on the right side; hence h is a function of zero variables. The only function of zero variables is a constant, so kT2 /m = C. This pattern illustrates a famous quote from the statistician and physicist Harold Jeffreys [6, p. 82]:

```
        A good table of functions of one variable may require a page; that of a function of
        two variables a volume; that of a function of three variables a bookcase; and that of
        a function of four variables a library.
```

Use dimensions; avoid tables as big as a library!

### 7.4 Hydrogen atom

Hydrogen is the simplest atom, and studying hydrogen is the simplest way to understand the atomic theory. Feynman has explained the importance of the atomic theory in his famous lectures on physics [7, p. 1-2]:

```
        If, in some cataclysm, all of scientiﬁc knowledge were to be destroyed, and only
        one sentence passed on to the next generations of creatures, what statement would
        contain the most information in the fewest words? I believe it is the atomic hypothesis
        (or the atomic fact, or whatever you wish to call it) that all things are made of atoms
        – little particles that move around in perpetual motion, attracting each other when they
        are a little distance apart, but repelling upon being squeezed into one another. In that one
        sentence, you will see, there is an enormous amount of information about the world. . .
```

The atomic theory was ﬁrst stated by Democritus. (Early Greek science and philosophy is discussed with wit, sympathy, and insight in Bertrand Russell’s History of Western Philosophy [8].) Democritus could not say much about the properties of atoms. With modern knowledge of classical and quantum mechanics, and dimensional analysis, you can say more.

7.4.1 Dimensional analysis

The next example of dimensional reasoning is the hydrogen atom in order to answer two questions. The ﬁrst question is how big is it. That size sets the size of more complex atoms and molecules. The second question is how much energy is needed to disassemble hydrogen. That energy sets the scale for the bond energies of more complex substances, and

those energies determine macroscopic quantities like the stiffness of materials, the speed of sound, and the energy content of fat and sugar. All from hydrogen! The ﬁrst step in a dimensional analysis is to choose the relevant variables. A simple model of hydrogen is an electron orbiting a proton. The orbital force is provided by electrostatic attraction between the proton and electron. The magnitude of the force is

```
                                              e2 1
                                                     ,
                                             4π0 r2
```

where r is the distance between the proton and electron. The list of variables should include enough variables to generate this expression for the force. It could include q, 0 , and r separately. But that approach is needlessly complex: The charge q is relevant only because it produces a force. So the charge appears only in the combined quantity e2 /4π0 . A similar argument applies to 0 .

```
Therefore rather than listing q and 0 separately, list only        Var          Dim
e2 /4π0 . And rather than listing r, list a0 , the common no-      T−1       f requency
tation for the Bohr radius (the radius of ideal hydrogen).          L−1      wavenumber
The acceleration of the electron depends on the electrosta-         LT−2        gravity
tic force, which can be constructed from e2 /4π0 and a0 , and       L           depth
on its mass me . So the list should also include me . To ﬁnd        ML−3        density
the dimensions of e2 /4π0 , use the formula for force              MT−2
                              e2  1
                        F=           .
                             4π0 r2
Then
                                        
                                     e2      
                                           = r2 × [F] = ML3 T−2 .
                                    4π0
```

The next step is to make dimensionless groups. However, no combination of these three items is dimensionless. To see why, look at the time dimension because it appears in only one quantity, e2 /4π0 . So that quantity cannot occur in a dimensionless group: If it did, there would be no way to get rid of the time dimensions. From the two remaining quantities, a0 and me , no dimensionless group is possible. The failure to make a dimensionless group means that hydrogen does not exist in the simple model as we have formulated it. I neglected important physics. There are two possibilities for what physics to add. One possibility is to add relativity, encapsulated in the speed of light c. So we would add c to the list of variables. That choice produces a dimensionless group, and therefore produces a size. However, the size is not the size of hydrogen. It turns out to be the classical electron radius instead. Fortunately, you do not have to know what the classical electron radius is in order to understand why the resulting size is not the size of hydrogen. Adding relativity to the physics – or adding c to the list – allows radiation. So the orbiting, accelerating electron would radiate. As radiation carries energy away from the electron, it spirals into the proton, meaning that in this world hydrogen does not exist, nor do other atoms.

```
      The other possibility is to add quantum mechanics, which was developed to solve funda­
      mental problems like the existence of matter. The physics of quantum mechanics is com­
      plicated, but its effect on dimensional analyses is simple: It contributes a new constant of
      nature � whose dimensions are those of angular momentum. Angular momentum is mvr,
      so

                                               [�] = ML2 T−1 .

      The � might save the day. There are now two quantities            Var       Dim      What
      containing time dimensions. Since e2 /4π0 has T−2 and              a0       L       size
      � has T−1 , the ratio �2 /(e2 /4π0 ) contains no time dimen­    e /4π0
                                                                        2        ML3 T−2
      sions. Since                                                       me        M       electron mass
                                       
                                   �2                                     �      ML2 T−1   quantum
                                          = ML,
                               e2 /4π0

      a dimensionless group is

                                                       �2
                                               a0 me (e2 /4π0 )

      It turns out that all dimensionless groups can be formed from this group. So, as in the
      spring–mass example, the only possible true statement involving this group is

                                         �2
                                                   = dimensionless constant.
                                 a0 me (e2 /4π0 )

      Therefore, the size of hydrogen is

                                                          �2
                                             a0 ∼                  .
                                                    me (e2 /4π0 )

      Putting in values for the constants gives

                                         a0 ∼ 0.5Å = 0.5 · 10−10 m.

      It turns out that the missing dimensionless constant is 1, so the dimensional analysis has
      given the exact answer.
```

7.4.2 Atomic sizes and substance densities

```
      Hydrogen has a diameter of 1Å. A useful consequence is the rule of thumb is that a typical
      interatomic spacing is 3Å. This approximation gives a reasonable approximation for the
      densities of substances, as this section explains.

      7 Dimensions                                                                                 57

      Let A be the atomic mass of the atom; it is (roughly) the number of pro-                           a
      tons and neutrons in the nucleus. Although A is called a mass, it is                                   a
      dimensionless. Each atom occupies a cube of side length a ∼ 3 Å, and
      has mass Amproton . The density of the substance is

                                      mass    Amproton
                                ρ=          ∼          .
                                     volume    (3 Å)3

      You do not need to remember or look up mproton if you multiply this
      fraction by unity in the form of NA /NA , where NA is Avogadro’s number:
                                                  Amproton NA
                                             ρ∼                  .
                                                  (3 Å)3 × NA

      The numerator is A g, because that is how NA is deﬁned. The denominator is

                                        3 · 10−23 cm3 × 6 · 1023 = 18.

      So instead of remembering mproton , you need to remember NA . However, NA is more famil­
      iar than mproton because NA arises in chemistry and physics. Using NA also emphasizes the
      connection between microscopic and macroscopic values. Carrying out the calculations:
                                                   A
                                              ρ∼      g cm−3 .
                                                   18

      The table compares the estimate against reality. Most every-
      day elements have atomic masses between 15 and 150, so the          Element    ρestimated  ρactual
      density estimate explains why most densities lie between 1 and      Li             0.39      0.54
      10 g cm−3 . It also shows why, for materials physics, cgs units     H2 O           1.0       1.0
      are more convenient than SI units are. A typical cgs density of     Si             1.56      2.4
                        −3
      a solid is 3 g cm , and 3 is a modest number and easy to re-        Fe             3.11      7.9
      member and work with. However, a typical SI density of a solid      Hg            11.2      13.5
                 −3
      3000 kg m . Numbers such as 3000 are unwieldy. Each time            Au            10.9      19.3
      you use it, you have to think, ‘How many powers of ten were         U             13.3      18.7
      there again?’ So the table tabulates densities using the cgs units
      of g cm−3 . I even threw a joker into the pack – water is not an element! – but the density
      estimate is amazingly accurate.

7.4.3 Physical interpretation

      The previous method, dimensional analysis, is mostly mathematical. As a second computa­
      tion of a0 , we show you a method that is mostly physics. Besides checking the Bohr radius,
      it provides a physical interpretation of it. The Bohr radius is the radius of the orbit with the
      lowest energy (the ground state). The energy is a sum of kinetic and potential energy. This
      division suggests, again, a divide-and-conquer approach: ﬁrst the kinetic energy, then the
      potential energy.
```

What is the origin of the kinetic energy? The electron does not orbit in any classical sense. If it orbited, it would, as an accelerating charge, radiate energy and spiral into the nucleus. According to quantum mechanics, however, the proton conﬁnes the electron to a region of size r – still unknown to us – and the electron exists in a so-called stationary state. The nature of a stationary state is mysterious; no one understands quantum mechanics, so no one understands stationary states except mathematically. However, in an approximate estimate you can ignore details such as the meaning of a stationary state. The necessary information here is that the electron is, as the name of the state suggests, stationary: It does not radiate. The problem then is to ﬁnd the size of the region to which the electron is conﬁned. In reality the electron is smeared over the whole universe; however, a signiﬁcant amount of it lives within a typical radius. This typical radius we estimate and call a0 . For now let this radius be an unknown r and study how the kinetic energy depends on r. Conﬁnement gives energy to the electron according

```
to the uncertainty principle:                                                                  E=0

                                ΔxΔp ∼ �,
```

where Δx is the position uncertainty and Δp is the momentum uncer­

```
                                                                                                    2
                                                                                               − e /4π
                                                                                                    2r
                                                                                                        0
```

tainty of the electron. In this model Δx ∼ r, as shown in the ﬁgure, so

```
                                                                                      2

Δp ∼ �/r. The kinetic energy of the electron is                                KE ∼ e /4
                                                                                       2r
                                                                                         π0

                                      (Δp)2    �2                                                   2
                                                                                               − e /4π 0

                         EKinetic ∼         ∼       .                            Δx ∼ r             r
                                       me     me r2
```

This energy is the conﬁnement energy or the uncertainty energy. This idea recurs in the book. The potential energy is the classical expression

```
                                                          e2
                                        EPotential ∼ −          .
                                                         4π0 r
The total energy is the combination

                                                             e2     �2
                           E = EPotential + EKinetic ∼ −          +      .
                                                            4π0 r me r2
```

The two energies compete. At small r, kinetic energy wins, because of the 1/r2 ; at large r, potential energy wins, because it goes to zero less rapidly. Is there a minimum combined energy at some intermediate value of r? There has to be. At small r, the slope dE/dr is negative. At large r, it is positive. At an intermediate r, the slope crosses between positive and negative. The energy is a a minimum there. The location would be easy to estimate if the energy were written in dimensionless form. Such a rewriting is not mandatory in this example, but it is helpful in complicated examples and is worth learning in this example. In constructing the dimensionless group containing a0 , we constructed another length:

```
                                                     �2
                                          l=                  .
                                               me (e2 /4π0 )
```

To scale any length – to make it dimensionless – divide it by l. So in the total energy the scaled radius

```
                                                   r
                                               r̄ ≡ .
                                                   l
```

The other unknown in the total energy is the energy itself. To make it dimensionless, a reasonable energy scale to use is e2 /4π0 l by deﬁning scaled energy as

```
                                                   E
                                        Ē ≡                .
                                               e2 /4π0 l
```

Using the dimensionless length and energy, the total energy

```
                                                             e2     �2
                          E = EPotential + EKinetic ∼ −           +
                                                            4π0 r me r2
becomes
                                              1 1
                                        Ē ∼ − + 2 .
                                              r̄ r¯
```

The ugly constants are placed into the deﬁnitions of scaled length and energy. This dimensionless energy is easy to think about and to sketch. Simple calculus: minimizing scaled energy Ē versus scaled bond length r̄. The scaled energy is the sum of potential and kinetic energy. The shape of this energy illustrates Feynman’s explanation of the atomic hypothesis. At a ‘little distance apart’ – for large r̄ – the curve slopes upward; to lower their energy, the proton and electron prefer to move closer, and the resulting force is attractive. ‘Upon being squeezed into one another’ – for small r̄ – the potential rapidly increases, so the force between the particles is repulsive. Somewhere between the small and large regions of r̄, the force is zero.

```
                    2

                   1.5

                    1
               ¯
               E
                   0.5
                                                                           −PE
                             Estimate                                            KE
                    0
                                         Actual                                  Total

                            1           2               3          4         5
                                                  r̄
```

Calculus (differentiation) locates this minimum-energy r̄ at r̄min = 2. An alternative method is cheap minimization: When two terms compete, the minimum occurs when the terms are roughly equal. This method of minimization is familiar from Section 6.2.2. Equating the two terms r̄−1 and r̄−2 gives r̄min ∼ 1. This result gives a scaled length. In actual units, it is

```
                                                        �2
                                rmin = lr̄min =                  ,
                                                  me (e2 /4π0 )
```

which is the Bohr radius computed using dimensional analysis. The sloppiness in estimating the kinetic and potential energies has canceled the error introduced by cheap minimization! Here is how to justify cheap minimization. Consider a reasonable general form for E:

```
                                                A    B
                                       E(r) =    n
                                                   − m.
                                                r   r
```

This form captures the important feature of the combined energy

```
                                                          e2     �2
                         E = EPotential + EKinetic ∼ −         +      ,
                                                         4π0 r me r2
```

that two terms represent competing physical effects. Mathematically, that physical fact is shown by the opposite signs. To ﬁnd the minimum, solve E (rmin ) = 0 or

```
                                       A       B
                                    −n n+1 + m m+1 = 0.
                                      rmin    rmin

The solution is
                                A      n   B
                                n   =    m              (calculus).
                               rmin   m rmin
```

This method minimizes the combined energy by equating the two terms A/rn and B/rm :

```
                                           A        B
                                             = m .
                                        rnmin rmin
```

This approximation lacks the n/m factor in the exact result. The ratio of the two estimates for rmin is

```
                           approximate estimate   n 1/(m−n)
                                                ∼           ,
                             calculus estimate    m
```

which is smaller than 1 unless n = m, when there is no maximum or minimum. So the approximate method underestimates the location of minima and maxima. To judge the method in practice, apply it to a typical example: the potential between nonpolar atoms or molecules, such as between helium, xenon, or methane. This potential is well approximated by the so-called Lennard–Jones potential where m = 6 and n = 12:

```
                                                 A    B
                                      U(r) ∼     12
                                                    − 6.
                                                r    r
```

The approximate result underestimates rmin by a factor of

```
                                        12 1/6
                                               ∼ 1.15.
                                         6

   7 Dimensions                                                                                61
```

An error of 15 percent is often small compared to the other inaccuracies in an approximate computation, so this method of approximate minimization is a valuable time-saver. Now return to the original problem: determining the Bohr radius. The approximate minimization predicts the correct value. Even if the method were not so charmed, there is no point in doing a proper, calculus minimization. The calculus method is too accurate given the inaccuracies in the rest of the derivation. Engineers understand this idea of not over-engineering a system. If a bicycle most often breaks at welds in the frame, there is little point replacing the metal between the welds with expensive, high-strength aerospace materials. The new materials might last 100 years instead of 50 years, but such a replacement would be overengineering. To improve a bicycle, put effort into improving or doing without the welds. In estimating the Bohr radius, the kinetic-energy estimate uses a crude form of the uncertainty principle, ΔpΔx ∼ �, whereas the true statement is that ΔpΔx ≥ �/2. The estimate also uses the approximation EKinetic ∼ (Δp)2 /m. This approximation contains m instead of 2m in the denominator. It also assumes that Δp can be converted into an energy as though it were a true momentum rather than merely a crude estimate for the root-mean-square momentum. The potential- and kinetic-energy estimates use a crude deﬁnition of position uncertainty Δx: that Δx ∼ r. After making so many approximations, it is pointless to minimize the result using the elephant gun of differential calculus. The approximate method is as accurate as, or perhaps more accurate than the approximations in the energy. This method of equating competing terms is balancing. We balanced the kinetic energy against the potential energy by assuming that they are roughly the same size. The consequence is that

```
                                                      �2
                                         a0 ∼                  .
                                                me (e2 /4π0 )
```

Nature could have been unkind: The potential and kinetic energies could have differed by a factor of 10 or 100. But Nature is kind: The two energies are roughly equal, except for a constant that is nearly 1. ‘Nearly 1’ is also called of order unity. This rough equality occurs in many examples, and you often get a reasonable answer by pretending that two energies (or two quantities with the same units) are equal. When the quantities are potential and kinetic energy, as they often are, you get extra safety: The so-called virial theorem protects you against large errors (for more on the virial theorem, see any intermediate textbook on classical dynamics).

### 7.5 Bending of light by gravity

Rocks, birds, and people feel the effect of gravity. So why not light? The analysis of that question is a triumph of Einstein’s theory of general relativity. I can calculate how gravity bends light by solving the so-called geodesic equations from general relativity:

```
                                      d2 xβ          μ
                                                β dx dx
                                                        ν
                                            + Γ μν        = 0.
                                      dλ2          dλ dλ

                                              β
```

To compute the Christoffel symbols Γμν requires solving for the metric tensor gμν , which requires solving the curvature equations Rμν = 0. The curvature equations are a shorthand for ten partial-differential equations. The equations are rich in mathematical interest but are a nightmare to solve. The equations are numerous – that’s one problem – but worse, they are not linear. So the standard trick, which is to guess a type of solution and form new solutions by combining the basic types, does not work. You can spend a decade learning advanced mathematics to solve the equations exactly. Or you can accept the great principle of analysis: When the going gets tough, lower your standards. If I sacriﬁce accuracy, I can explain light bending in less than one thousand pages using mathematics and physics that you (and I!) already know. The simpler method is dimensional analysis, in the usual three steps:

1. Find the relevant parameters.
2. Find dimensionless groups.
3. Use the groups to make the most general dimensionless statement.
4. Add physical knowledge to narrow the possibilities.
The following sections do each step.

7.5.1 Finding parameters

The ﬁrst step in a dimensional analysis is to decide what physical parameters the bending angle can depend on. An unlabeled diagram prods me into thinking of labels, many of which are parameters of the problem:

```
                                                    sun
```

Here are reasons to include various parameters:

1. The list has to include the quantity to solve for. So the angle θ is the ﬁrst item in the list.
2. The mass of the sun, m, has to affect the angle. Black holes greatly deﬂect light, probably
```
        because of their huge mass.
```

3. A faraway sun or black hole cannot strongly affect the path (near the earth light seems
```
        to travel straight, in spite of black holes all over the universe); therefore r, the distance
        from the center of the mass, is a relevant parameter. The phrase ‘distance from the
        center’ is ambiguous, since the light is at various distances from the center. Let r be the
        distance of closest approach.
```

4. The dimensional analysis needs to know that gravity produces the bending. The para­
```
        meters listed so far do not create any forces. So include Newton’s gravitational constant
        G.
```

Here is the same diagram with important parameters labeled:

```
     7 Dimensions                                                                            63

                                                                                     θ

                                                    r

                                                   sun
                                                  mass m
```

Here is a table of the parameters and their dimensions:

```
                         Parameter Meaning                       Dimensions
                         θ         angle                         –
                         m         mass of sun                   M
                         G         Newton’s constant             L3 T−2 M−1
                         r         distance from center of sun   L
```

where, as you might suspect, L, M, and T represent the dimensions of length, mass, and time, respectively.

7.5.2 Dimensionless groups

What are the dimensionless groups? The parameter θ is an angle, which is already dimensionless. The other variables, G, m, and r, cannot form a second dimensionless group. To see why, following the dimensions of mass. It appears only in G and m, so a dimensionless group would contain the product Gm, which has no mass dimensions in it. But Gm and r cannot get rid of the time dimensions. So there is only one independent dimensionless group, for which θ is the simplest choice. I want a second dimensionless group because otherwise my analysis seems like nonsense. Any physical solution can be written in dimensionless form; this idea is the foundation of dimensional analysis. With only one dimensionless group, θ, I have to conclude that θ depends on no variables at all:

```
                             θ = function of other dimensionless groups,
```

but there are no other dimensionless groups, so

```
                                              θ = constant.
```

This conclusion is crazy! The angle must depend on at least one of m and r. My physical picture might be confused, but it’s not so confused that neither variable is relevant. So I need to make another dimensionless group on which θ can depend. Therefore, I return to Step 1: Finding parameters. The list so far lacks a crucial parameter. What physics have I neglected? Free associating often suggests the missing parameter. Unlike rocks, light is difﬁcult to deﬂect, otherwise humanity would not have waited until

the 1800s to study the deﬂection, whereas the path of rocks was studied at least as far back as Aristotle and probably for millions of years beforehand. Light travels much faster than rocks, which may explain why light is so difﬁcult to deﬂect: The gravitational ﬁeld ‘gets hold of it’ only for a short time. But none of my parameters distinguish between light and rocks. Therefore I should include c, the speed of light. It introduces the fact that I’m studying light, and it does so with a useful distinguishing parameter, the speed. Here is the latest table of parameters and dimensions:

```
                        Parameter    Meaning                        Dimensions
                        θ            angle                          –
                        m            mass of sun                    M
                        G            Newton’s constant              L3 T−2 M−1
                        r            distance from center of sun    L
                        c            speed of light                 LT−1
```

Length is strewn all over the parameters (it’s in G, r, and c). Mass, however, appears in only G and m, so I already know I need a combination such as Gm to cancel out mass. Time also appears in only two parameters: G and c. To cancel out time, I need to form Gm/c2 . This combination has one length in it, so a dimensionless group is Gm/rc2 .

7.5.3 Drawing conclusions

The most general relation between the two dimensionless groups is

```
                                                       Gm
                                              θ= f         .
                                                       rc2
```

Dimensional analysis cannot tell me the correct function f . Physical reasoning and symmetry narrow the possibilities. First, strong gravity – from a large G or m – should increase the angle. So f should be an increasing function. Now try symmetry: Imagine a world where gravity is repulsive or, equivalently, the gravitational constant is negative. Then the angle should also be negative, so f should be an odd function. This symmetry argument eliminates choices like f (Gm/rc2 ) ∼ (Gm/rc2 )2 . The simplest guess is that f is the identity function. Then the bending angle is

```
                                                       Gm
                                                θ=         .
                                                       rc2
```

There is likely a dimensionless constant in f :

```
                                                        Gm
                                               θ=7
                                                        rc2
     or
                                                         Gm
                                              θ = 0.3
                                                         rc2
     are also possible. This freedom means

     7 Dimensions                                                                               65

                                                      Gm
                                                 θ∼       .
                                                      rc2
```

7.5.4 Comparison with exact calculations

Different theories of gravity give the same result

```
                                                      Gm
                                                 θ∼       ;
                                                      rc2
```

the only variation is in the value for the missing dimensionless constant. Here are those values from exact calculation:

```
                                           ⎧
                                           ⎪ 1 (simplest guess);
                                     Gm ⎪  ⎪
                                           ⎨
                                 θ= 2 ×⎪   ⎪ 2 (Newtonian gravity);
                                     rc    ⎪
                                           ⎩ 4 (Einstein’s theory).
```

Here is a rough explanation of the origin of those constants. The 1 for the simplest guess is just that. The 2 for Newtonian gravity is from integrating angular factors like cosine and sine that determine the position of the photon as it moves toward and past the sun. The most interesting constant is the 4 for general relativity, which is twice the Newtonian value because light moves at the speed of light. The extra bending is a consequence of Einstein’s theory of special relativity putting space and time on the same level. The theory of general relativity then formulates gravity in terms of the curvature of spacetime. Newton’s theory is the limit of general relativity that considers only time curvature; general relativity itself also calculates the space curvature. Since most objects move much slower than the speed of light, meaning that they travel much farther in time than in space, they feel mostly the time curvature. The Newtonian analysis is ﬁne for those objects. Since light moves at the speed of light, it sees equal amounts of space and time curvature, so it bends twice as far as the Newtonian theory would predict.

7.5.5 Numbers!

At the surface of the Earth, the strength is

```
                       Gm        6.7 · 10−11 m3 s−2 kg−1 × 6.0 · 1024 kg
                           ∼                                                 ∼ 10−9 .
                       rc2   6.4 · 106 m × 3.0 · 108 m s−1 × 3.0 · 108 m s−1
```

This miniscule value is the bending angle (in radians). So if physicists want to show that light bends, they had better look beyond the earth! That statement is based on another piece of dimensional analysis and physical reasoning, whose result I quote without proof: A telescope with mirror of diameter d can resolve angles roughly as small as λ/d, where λ is the wavelength of light. One way to measure the bending of light is to measure the change in position of the stars. A lens that could resolve an angle of 10−9 has a diameter of at least

```
                                                0.5 · 10−6 m
                                    d ∼ λ/θ ∼                ∼ 500 m.
                                                    10−9
```

Large lenses warp and crack; one of the largest lenses made is 6 m. So there is no chance of detecting an angle of 10−9 . Physicists therefore searched for another source of light bending. In the solar system, the largest mass is the sun. At the surface of the sun, the ﬁeld strength is

```
                Gm        6.7 · 10−11 m3 s−2 kg−1 × 2.0 · 1030 kg
                    ∼                                                 ∼ 2.1 · 10−6 ≈ 0.4 .
                rc2   7.0 · 108 m × 3.0 · 108 m s−1 × 3.0 · 108 m s−1
```

This angle, though small, is possible to detect: The required lens diameter is roughly

```
                                                0.5 · 10−6 m
                                    d ∼ λ/θ ∼                ∼ 20 cm.
                                                 2.1 · 10−6
```

The eclipse expedition of 1919, led by Arthur Eddington of Cambridge, tried to measure exactly this effect. For many years Einstein believed that his theory of gravity would predict the Newtonian value, which turns out to be 0.87 arcseconds for light just grazing the surface of the sun. The German mathematician, Soldner, derived the same result in 1803. Fortunately for Einstein’s reputation, the eclipse expeditions that went to test his (and Soldner’s) prediction got rained or clouded out. By the time an expedition got lucky with the weather (Eddington’s in 1919), Einstein had invented a new theory of gravity, which predicted 1.75 arcseconds. The goal of Eddington’s expedition was to decide between the Newtonian and general relativity values. The measurements are difﬁcult, and the results were not accurate enough to decide which theory was right. But 1919 was the ﬁrst year after the World War, in which Germany and Britain had fought each other almost to oblivion. A theory invented by a German, conﬁrmed by an Englishman (from Newton’s university, no less) – such a picture was comforting after the trauma of war, so the world press and scientiﬁc community saw what they wanted to: Einstein vindicated! A proper conﬁrmation of Einstein’s prediction came only with the advent of radio astronomy, which could measure small deﬂections accurately. I leave you with this puzzle: If the accuracy of a telescope is λ/d, how could radio telescopes be more accurate than optical ones, since radio waves have a longer wavelength than light has?!

### 7.6 Buckingham Pi theorem

The second step is in a dimensional analysis is to make dimensionless groups. That task is simpler by knowing in advance how many groups to look for. The Buckingham Pi theorem provides that number. I derive it with a series of examples. Here is a possible beginning of the theorem statement: The number of dimensionless groups is. . . . Try it on the light-bending example. How many groups can the variables θ, G, m, r, and c produce? The possibilities include θ, θ2 , Gm/rc2 , θGm/rc2 , and so on. The possibilities are inﬁnite! Now apply the theorem statement to estimating the size of hydrogen, before including quantum mechanics in the list of variables. That list is a0 (the size), e2 /4π0 , and me . That list produces no dimensionless groups. So it seems that the number of groups would be zero – if no groups are possible – or inﬁnity, if even one group is possible.

Here is an improved theorem statement taking account of the redundancy: The number of independent dimensionless groups is. . . . To complete the statement, try a few examples:

1. Bending of light. The ﬁve quantities θ, G, m, r, and c produce two independent groups.
A convenient choice for the two groups is θ and Gm/rc2 , but any other independent set is equally valid, even if not as intuitive.

2. Size of hydrogen without quantum mechanics. The three quantities a0 (the size), e2 /4π0 ,
and me produce zero groups.

3. Size of hydrogen with quantum mechanics. The four quantities a0 (the size), e2 /4π0 ,
me , and � produce one independent group.

These examples ﬁt a simple pattern:

```
                    no. of independent groups = no. of quantities − 3.
```

The 3 is a bit distressing because it is a magic number with no explanation. It is also the number of basic dimensions: length, mass, and time. So perhaps the statement is

```
            no. of independent groups = no. of quantities − no. of dimensions.
```

Test this statement with additional examples:

1. Period of a spring–mass system. The quantities are T (the period), k, m, and x0 (the
amplitude). These four quantities form one independent dimensionless group, which could be kT2 /m. This result is consistent with the proposed theorem.

2. Period of a spring–mass system (without x0 ). Since the amplitude x0 does not affect
the period, the quantities could have been T (the period), k, and m. These three quantities form one independent dimensionless group, which again could be kT2 /m. This result is also consistent with the proposed theorem, since T, k, and m contain only two dimensions (mass and time).

The theorem is safe until we try to derive Newton’s second law. The force F depends on mass m and acceleration a. Those three quantities contain three dimensions – mass, length, and time. Three minus three is zero, so the proposed theorem predicts zero independent dimensionless groups. Whereas F = ma tells me that F/ma is a dimensionless group.

```
This problem can be ﬁxed by adding one word. Look at the            Var      Dim
dimensions of F, m, and a. All the dimensions – M or MLT−2           F     MLT−2
or LT−2 – can be constructed from only two dimensions: M and         m        M
LT−2 . The key idea is that the original set of three dimensions      a      LT−2
```

are not independent, whereas the pair M and LT−2 are independent. So:

```
      no. of independent groups = no. of quantities − no. of independent dimensions.
```

And that statement is the Buckingham Pi theorem [9].

# Part 3. Discarding Information

```
8. Special cases   69
9. Disretization   91
10. Springs        97
```

## 8. Special cases

### 8.1 Pyramid volume

I have been promising to explain the factor of one-third in the volume of a pyramid:

```
                                                1
                                             V = hb2 .
                                                3
```

Although the method of special cases mostly cannot explain a dimensionless constant, the volume of a pyramid provides a rare counterexample. I ﬁrst explain the key idea in fewer dimensions. So, instead of immediately explaining the one-third in the volume of a pyramid, which is a difﬁcult threedimensional problem, ﬁrst ﬁnd the corresponding constant in a two-dimensional

problem. That problem is the area of a triangle with base b and height h: The area is A ∼ bh. What is the constant? Choose a convenient triangle, perhaps a

45-degree right triangle where h = b. Two of those triangles form a square with area b2 , so A = b2 /2 when h = b. The constant in A ∼ bh is therefore 1/2 no matter what b and h are, so A = bh/2. Now use the same construction in three dimensions. What square-based pyramid, when combined with itself perhaps several times, makes a familiar shape? Only the aspect ratio h/b matters in the following discussion. So choose b conveniently, and then choose h to make a pyramid with the clever aspect ratio. The goal shape is suggested by the square pyramid base. Another solid with the same base is a cube. Perhaps several pyramids can combine into a cube of side b. To simplify the upcoming arithmetic, I choose b = 2. What should the height h be? To decide, imagine how the cube will be constructed. Each cube has six faces, so six pyramids might make a cube where each pyramid base forms one face of the cube, and each pyramid tip faces inward, meeting in the center of the cube. For the tips to meet in the center of the cube, the height must be h = 1. So six pyramids with b = 2, and h = 1 make a cube with side length 2. The volume of one pyramid is one-sixth of the volume of the cube:

```
                                         cube volume 8 4
                                    V=              = = .
                                              6      6 3
```

The volume of the pyramid is V ∼ hb2 , and the missing constant must make volume 4/3. Since hb2 = 4 for these pyramids, the missing constant is 1/3. Voilà:

```
                                                 1     4
                                              V = hb2 = .
                                                 3     3
```

### 8.2 Mechanics

8.2.1 Atwood machine

The next problem illustrates dimensional analysis and special cases in a physical problem. Many of the ideas and methods from the geometry example transfer to this problem, and it introduces more methods and ways of reasoning. The problem is a staple of ﬁrst-year physics: Two masses, m1 and m2 , are connected and, thanks to a pulley, are free to move up and down. What is the acceleration of the masses and the tension in the string? You can solve this problem with standard methods from ﬁrst-year physics, which means that you can can check the solution that we derive using

```
                                                                                                          m1
```

dimensional analysis, educated guessing, and a feel for functions.

```
                                                                                                               m2
```

The ﬁrst problem is to ﬁnd the acceleration of, say, m1 . Since m1 and m2 are connected by a rope, the acceleration of m2 is, depending on your sign convention, either equal to m1 or equal to −m1 . Let’s call the acceleration a and use dimensional analysis to guess its form. The ﬁrst step is to decide what variables are relevant. The acceleration depends on gravity, so g should be on the list. The masses affect the acceleration, so m1 and m2 are on the list. And that’s it. You might wonder what happened to the tension: Doesn’t it affect the acceleration? It does, but it is itself a consequence of m1 , m2 , and g. So adding tension to the list does not add information; it would instead make the dimensional analysis difﬁcult.

```
     These variables fall into two pairs where the variables in each pair       Var    Dim
     have the same dimensions. So there are two dimensionless groups             a     LT−2
     here ripe for picking: G1 = m1 /m2 and G2 = a/g. You can make               g     LT−2
     any dimensionless group using these two obvious groups, as ex­             m1       M
     perimentation will convince you. Then, following the usual pat­            m2       M
     tern,
                                  a     m1
                                    = f    ,
                                  g     m2
```

where f is a dimensionless function. Pause a moment. The more thinking that you do to choose a clean representation, the less algebra you do later. So rather than ﬁnd f using m1 /m2 as the dimensionless group, ﬁrst choose a better group. The ratio m1 /m2 does not respect the symmetry of the problem in that only the sign of the acceleration changes when you interchange the labels m1 and m2 . Whereas m1 /m2 turns into its reciprocal. So the function f will have to do lots of work to turn the unsymmetric ratio m1 /m2 into a symmetric acceleration.

Back to the drawing board for how to ﬁx G1 . Another option is to use m1 − m2 . Wait, the difference is not dimensionless! I ﬁx that problem in a moment. For now observe the virtue of m1 − m2 . It shows a physically reasonable symmetry under mass interchange: G1 → −G1 . To make it dimensionless, divide it by another mass. One candidate is m1 :

```
                                                   m1 + m2
                                          G1 =             .
                                                     m1
```

That choice, like dividing by m2 , abandons the beloved symmetry. But dividing by m1 + m2 solves all the problems:

```
                                                   m1 − m2
                                          G1 =              .
                                                   m 1 + m2
```

This group is dimensionless and it respects the symmetry of the problem. Using this G1 , the solution becomes

```
                                         a     m1 − m2
                                           = f          ,
                                         g     m 1 + m2
```

where f is another dimensionless function. To guess f (x), where x = G1 , try special cases. First imagine that m1 becomes huge. A quantity with mass cannot be huge on its own, however. Here huge means huge relative to m2 , whereupon x ≈ 1. In this thought experiment, m1 falls as if there were no m2 so a = −g. Here we’ve chosen a sign convention with positive acceleration being upward.

```
                                                                                                 m1
```

If m2 is huge relative to m1 , which means x = −1, then m2 falls like a stone pulling m1 upward with acceleration a = g. A third limiting case is m1 = m2 or x = 0, whereupon the masses are in equilibrium so a = 0. Here is a plot of our knowledge of f :

```
                                               1

                                             f (x)

                                                         x
                                 -1                             1

                                              -1
```

The simplest conjecture – an educated guess – is that f (x) = x. Then we have our result:

```
                                          a m1 − m2
                                           =        .
                                          g m1 + m2
```

Look how simple the result is when derived in a symmetric, dimensionless form using special cases!

### 8.3 Drag

Pendulum motion is not a horrible enough problem to show the full beneﬁt of dimensional analysis. Instead try ﬂuid mechanics – a subject notorious for its mathematical and physical complexity; Chandrasekhar’s books [10, 11] or the classic textbook of Lamb [12] show that the mathematics is not for the faint of heart. The next examples illustrate two extremes of ﬂuid ﬂow: oozing and turbulent. An example of oozing ﬂow is ions transporting charge in seawater (Section 8.3.6). An example of turbulent ﬂow is a raindrop falling from the sky after condens­

```
                                                                                             Density ρﬂ
     ing out of a cloud (Section 8.3.7).                                                   Viscosity ν
```

To ﬁnd the terminal velocity, solve the partial-differential equations of ﬂuid mechanics for the incompressible ﬂow of a Newtonian ﬂuid:

```
                       ∂v             1                                                          ρobj
                          + (v·∇)v = − ∇p + ν∇2 v,           (3 eqns)
                       ∂t             ρ
                                ∇·v = 0.     (1 eqn)
                                                                                                  v
```

Here v is the ﬂuid velocity, ρ is the ﬂuid density, ν is the kinematic viscosity, and p is the pressure. The ﬁrst equation is a vector shorthand for three equations, so the full system is four equations. All the equations are partial-differential equations and three are nonlinear. Worse, they are coupled: Quantities appear in more than one equation. So we have to solve a system of coupled, nonlinear, partial-differential equations. This solution must satisfy boundary conditions imposed by the marble or raindrop. As the object moves, the boundary conditions change. So until you know how the object moves, you do not know the boundary conditions. Until you know the boundary conditions, you cannot ﬁnd the motion of the ﬂuid or of the object. This coupling between the boundary conditions and solution compounds the difﬁculty of the problem. It requires that you solve the equations and the boundary conditions together. If you ever get there, then you take the limit t → ∞ to ﬁnd the terminal velocity. Sleep easy! I wrote out the Navier–Stokes equations only to scare you into using dimensional analysis and special-cases reasoning. The approximate approach is easier than solving nonlinear partial-differential equations.

8.3.1 Naive dimensional analysis

To use dimensional analysis, follow the usual steps: Choose relevant variables, form dimensionless groups from them, and solve for the terminal velocity. In choosing quantities, do not forget to include the variable for which you are solving, which here is v. To decide on the other quantities, split them into three categories (divide and conquer):

1. characteristics of the ﬂuid, 2. characteristics of the object, and 3. characteristics of whatever makes the object fall.

The last category is the easiest to think about, so deal with it ﬁrst. Gravity makes the object fall, so g is on the list. Consider next the characteristics of the object. Its velocity, as the quantity for which we are solving, is already on the list. Its mass m affects the terminal velocity: A feather falls more slowly than a rock does. Its radius r probably affects the terminal velocity. Instead of listing r and m together, remix them and use r and ρobj . The two alternatives r and m or r and ρobj provide the same information as long as the object is uniform: You can compute ρobj from m and r and can compute m from ρobj and r. Choose the preferable pair by looking ahead in the derivation. The relevant properties of the ﬂuid include its density ρﬂ . If the list also includes ρobj , then the results might contain pleasing dimensionless ratios such as ρobj /ρﬂ (a dimensionless group!). The ratio ρobj /ρﬂ has a more obvious physical interpretation than a combination such as m/ρﬂ r3 , which, except for a dimensionless constant, is more obscurely the ratio of object and ﬂuid densities. So choose ρobj and r over m and r. Scaling arguments also favor the pair ρobj and r. In a scaling argument you imagine varying, say, a size. Size, like heat, is an extensive quantity: a quantity related to amount of stuff. When you vary the size, you want as few other variables as possible to change so that those changes do not obscure the effect of changing size. Therefore, whenever possible replace extensive quantities with intensive quantities like temperature or density. The pair m and r contains two extensive quantities, whereas the preferable pair ρobj and r contains only one extensive quantity. Now consider properties of the ﬂuid. Its density ρﬂ affects the terminal velocity. Perhaps its viscosity is also relevant. Viscosity measures the tendency of a ﬂuid to reduce velocity differences in the ﬂow. You can observe an analog of viscosity in trafﬁc ﬂow on a multilane highway. If one lane moves much faster than another, drivers switch from the slower to the faster lane, eventually slowing down the faster lane. Local decisions of the drivers reduce the velocity gradient. Similarly, molecular motion (in a gas) or collisions (in a ﬂuid) transports speed (really, momentum) from fast- to slow-ﬂowing regions. This transport reduces the velocity difference between the regions. Oozier (more viscous) ﬂuids probably produce more drag than thin ﬂuids do. So viscosity belongs on the list of relevant variables. Fluid mechanicians have deﬁned two viscosities: dynamic viscosity η and kinematic viscosity ν. [Sadly, we could not use the melliﬂuous term ﬂuid mechanics to signify a host of physicists agonizing over the equations of ﬂuid mechanics; it would not distinguish the toilers from their toil.] The two viscosities are related by η = ρﬂ ν. Life in Moving Fluids [13, pp. 23–25] discusses the two types of viscosity in detail. For the analysis of drag force, you need to know only that viscous forces are proportional to viscosity. Which viscosity should we use? Dynamic viscosity hides ρﬂ inside the product νρﬂ ; a ratio of ρobj and η then looks less dimensionless than it is because ρobj ’s partner ρﬂ is buried inside η. Therefore the kinematic viscosity ν usually gives the more insightful results. Summarizing the discussion, the table lists the variables by category.

```
     The next step is to ﬁnd dimensionless groups. The Buck-            Var      Dim
     ingham Pi theorem (Section 7.6) says that the six vari­              ν     L2 T−1
     ables and three independent dimensions result in three              ρﬂ     ML−3
     dimensionless groups.                                                r       L
     Before ﬁnding the groups, consider the consequences of               v      LT−1
     three groups. Three?! Three dimensionless groups pro­              ρobj    ML−3
     duce this form for the terminal velocity v:                          g      LT−2

          group with v = f (other group 1, other group 2).
```

To deduce the properties of f requires physics knowledge. However, studying a twovariable function is onerous. A function of one variable is represented by a curve and can be graphed on a sheet of paper. A function of two variables is represented by a surface. For a complete picture it needs three-dimensional paper (do you have any?); or you can graph many slices of it on regular two-dimensional paper. Neither choice is appealing. This brute-force approach to the terminal velocity produces too many dimensionless groups. If you simplify only after you reach the complicated form

```
                             group with v = f (other group 1, other group 2),
```

you carry baggage that you eventually discard. When going on holiday to the Caribbean, why pack skis that you never use but just cart around everywhere? Instead, at the beginning of the analysis, incorporate the physics knowledge. That way you simplify the remainder of the derivation. To follow this strategy of packing light – of packing only what you need – consider the physics of terminal velocity in order to make simpliﬁcations now.

8.3.2 Simpler approach

The adjective terminal in the phrase ‘terminal velocity’ hints at the physics that determines the velocity. Here ‘terminal’ is used in its sense of ﬁnal,

```
     as in after an inﬁnite time. It indicates that the velocity has become con- weight       drag
```

stant, which happens only when no net force acts on the marble. This line of thought suggests that we imagine the forces acting on the object: gravity, buoyancy, and drag. The terminal velocity is velocity at which the drag, gravitational, and buoyant forces combine to make zero net force. Divide-and-conquer reasoning splits the terminalvelocity problem into three simpler problems. The gravitational force, also known as the weight, is mg. Instead of m we use (4π/3)ρobj r3 – for the same reasons that we listed ρobj instead of

```
     m in the table of variables – and happily ignore the factor of 4π/3. With        weight           drag
     those choices, the weight is

                                                                                      ρsp r3 g
                                     Fg ∼ ρobj r3 g.

      8 Special cases                                                                                     75

      The ﬁgure shows the roadmap updated with this information.
      The remaining pieces are drag and buoyancy. Buoyancy is easier, so do it ﬁrst (the             lower p
      principle of maximal laziness). It is an upward force that results because gravity
      affects the pressure in a ﬂuid. The pressure increases according to p = p0 + ρﬂ gh,                 buoyant force

      where h is the depth and p0 is the pressure at zero depth (which can be taken to
      be at any level in the ﬂuid). The pressure difference between the top and bottom               Sphere

      of the object, which are separated by a distance ∼ r, is Δp ∼ ρﬂ gr. Pressure is
                                                                                                     higher p
      force per area, and the pressure difference acts over an area A ∼ r2 . Therefore the
      buoyant force created by the pressure difference is

                                              Fb ∼ AΔp ∼ ρﬂ r3 g.

      As a check on this result, Archimedes’s principle says that the buoyant               terminal velocity
      force is the ‘weight of ﬂuid displaced’. This weight is
                                       mass                                      weight           drag          buoyancy
                                      
                                       4π 3
                                    ρﬂ    πr g.
                                        3                                        ρsp r3 g                        ρﬂ r 3 g
                                         
                                        volume

      Except for the factor of 4π/3, it matches the buoyant force so Archimedes’s principle con­
      ﬁrms our estimate for Fb . That result updates the roadmap. The main unexplored branch
      is the drag force, which we solve using dimensional analysis.
```

8.3.3 Dimensional analysis for the drag force

```
      The weight and buoyancy were solvable without dimensional analysis, but we still need
      to use dimensional analysis to ﬁnd the drag force. The purpose of breaking the problem
      into parts was to simplify this dimensional analysis relative to the brute-force approach in
      Section 8.3.1. Let’s see how the list of variables changes when computing the drag force
      rather than the terminal velocity. The drag force Fd has to join the list: not a promising
      beginning when trying to eliminate variables. Worse, the terminal velocity v remains on
      the list, even though we are no longer computing it, because the drag force depends on the
      velocity of the object.
      However, all is not lost. The drag force has no idea what is inside the sphere. Picture the
      ﬂuid as a huge computer that implements the laws of ﬂuid dynamics. From the viewpoint
      of this computer, the parameters v and r are the only relevant attributes of a moving sphere.
      What lies underneath the surface does not affect the ﬂuid ﬂow: Drag is only skin deep. The
      computer can determine the ﬂow (if it has tremendous processing power) without knowing
      the sphere’s density ρobj , which means it vanishes from the list. Progress!

Now consider the characteristics of the ﬂuid. The ﬂuid      Var    Dim
supercomputer still needs the density and viscosity of      Fd    MLT−2
the ﬂuid to determine how the pieces of ﬂuid move in         ν    L2 T−1
response to the object’s motion. So ρﬂ and ν remain on      ρﬂ    ML−3
the list. What about gravity? It causes the object to fall,  r       L
so it is responsible for the terminal velocity v. However,   v     LT−1
```

the ﬂuid supercomputer does not care how the object acquired this velocity; it cares only what the velocity is. So g vanishes from the list. The updated tabled shows the new, shorter list. The ﬁve variables in the list are composed of three basic dimensions. From the Buckingham Pi theorem (Section 7.6), we expect two dimen­

```
sionless groups. We ﬁnd one group by dividing and conquering. The          weight            drag
```

list already includes a velocity (the terminal velocity). If we can concoct another quantity V with dimensions of velocity, then v/V is a di­

```
                                                                           ρsp r3 g          DA            ρﬂ r 3 g
```

mensionless group. The viscosity ν is almost a velocity. It contains one

```
more power of length than velocity does. Dividing by r eliminates the                 group 1
```

extra length: V ≡ ν/r. A dimensionless group is then

```
                                              v  vr
                                       G1 ≡     = .
                                              V  ν
```

Our knowledge, including this group, is shown in the ﬁgure. This group is so important that it has a name, the Reynolds number, which

```
is abbreviated Re. It is important because it is a dimensionless mea-      weight            drag
```

sure of ﬂow speed. The velocity, because it contains dimensions, cannot distinguish fast from slow ﬂows. For example, 1000 m s−1 is slow

```
                                                                           ρsp r3 g          DA            ρﬂ r 3 g
```

for a planet, whose speeds are typically tens of kilometers per second,

```
but fast for a pedestrian. When you hear that a quantity is small, fast,              group 1
```

large, expensive, or almost any adjective, your ﬁrst reaction should be to ask, ‘compared to what?’ Such a comparison suggests dividing v by another velocity; then we get a dimensionless quantity that is propor-

tional to v. The result of this division is the Reynolds number. Low values of Re indicate slow, viscous ﬂow (cold honey oozing out of a jar). High values indicate turbulent ﬂow (a jet ﬂying at 600 mph). The excellent Life in Moving Fluids [13] discusses many more dimensionless ratios that arise in ﬂuid mechanics. The Reynolds number looks lonely in the map. To give it company, ﬁnd a second dimensionless group. The drag force is absent from the ﬁrst group so it must live in the second; otherwise we cannot solve for the drag force. Instead of dreaming up the dimensionless group in one lucky guess, we construct it in steps (divide-and-conquer reasoning). Examine the variables in the table, dimension by dimension. Only two (Fd and ρﬂ ) contain mass, so both or neither appear in the group. Because Fd has to appear, ρﬂ must also appear. Each variable contains a ﬁrst power of mass, so the group contains the ratio Fd /ρﬂ . A simple choice is

```
                                       Fd
                                G2 ∝      .
                                       ρﬂ
```

The dimensions of Fd /ρﬂ are L4 T−2 , which is the square of L2 T−1 . Fortune smiles on us, for L2 T−1 are the dimensions of ν. So

```
                                                  Fd
                                                 ρﬂ ν2
```

is a dimensionless group. This choice, although valid, has a defect: It contains ν, which already belongs to the ﬁrst group (the Reynolds number). Of all the variables in the problem, ν is the one most likely to be found irrelevant based on a physical argument (as will happen in Section 8.3.7, when we specialize to high-speed ﬂow. If ν appears in two groups, eliminating it requires recombining the two groups into one that does not contain ν. However, if ν appears in only one group, then eliminating it is simple: eliminate that group. Simpler mathematics – eliminating a group rather than remixing two groups to get one group – requires simpler physical reasoning. Therefore, isolate ν in one group if possible. To remove ν from the proposed group Fd /ρﬂ ν2 notice that the product of two dimensionless groups is also dimensionless. The ﬁrst group

```
contains ν−1 and the proposed group contains ν−2 , so the ratio              weight            drag
                       group proposed      Fd
                                       =
                        (ﬁrst group) 2   ρﬂ r2 v2                            ρsp r3 g          DA            ρﬂ r 3 g
```

is not only dimensionless but it also does not contain ν. So the analysis

```
                                                                                        group 1        group 2
```

will be easy to modify when we try to eliminate ν. With this revised second group, our knowledge is now shown in this ﬁgure:

```
                                                                                          vR             Fd
This group, unlike the the proposal Fd /ρﬂ ν2 , has a plausible physical                   ν
```

interpretation. Imagine that the sphere travels a distance l, and use l to multiply the group by unity:

```
                                    Fd        l      Fd l
                                          ×      =           .
                                  ρﬂ r v
                                      2 2     l    ρﬂ lr2 v2
                                        
                                                  1
                                  group 1
```

The numerator is the work done against the drag force over the distance l. The denominator is also an energy. To interpret it, examine its parts (divide and conquer). The product lr2 is, except for a dimensionless constant, the volume of ﬂuid swept out by the object. So ρﬂ lr2 is, except for a constant, the mass of ﬂuid shoved aside by the object. The object moves ﬂuid with a velocity comparable to v, so it imparts to the ﬂuid a kinetic energy

```
                                            EK ∼ ρﬂ lr2 v2 .
```

Thus the ratio, and hence the group, has the following interpretation:

```
                                  work done against drag
                                                                .
                            kinetic energy imparted to the ﬂuid

      In highly dissipative ﬂows, when energy is burned directly up by viscosity, the numerator
      is much larger than the denominator, so this ratio (which will turn out to measure drag) is
      much greater than 1. In highly streamlined ﬂows (a jet wing), the the work done against
      drag is small because the ﬂuid returns most of the imparted kinetic energy to the object. So
      in the ratio, the numerator will be small compared to the denominator.
      To solve for Fd , which is contained in G2 , use the form G2 = f (G1 ), which becomes
                                               Fd         vr
                                                      = f    .
                                             ρﬂ r v
                                                 2  2     ν

      The drag force is then
                                                              vr
                                            Fd = ρﬂ r2 v2 f      .
                                                              ν
      The function f is a dimensionless function: Its argument is dimensionless and it returns a
      dimensionless number. It is also a universal function. The same f applies to spheres of any
      size, in a ﬂuid of any viscosity or density! Although f depends on r, ρﬂ , ν, and v, it depends
      on them only through one combination, the Reynolds number. A function of one variable
      is easier to study than is a function of four variables:
         A good table of functions of one variable may require a page; that of a function of
         two variables a volume; that of a function of three variables a bookcase; and that of
         a function of four variables a library.
              —Harold Jeffreys [6, p. 82]
      Dimensional analysis cannot tell us the form of f . To learn its form, we specialize to two
      special cases:

      1. viscous, low-speed ﬂow (Re  1), the subject of Section 8.3.4; and
      2. turbulent, high-speed ﬂow (Re  1), the subject of Section 8.3.7.

8.3.4 Viscous limit

      As an example of the low-speed limit, consider a marble falling in vegetable oil or glycerin.
      You may wonder how often marbles fall in oil, and why we bother with this example. The
      short answer to the ﬁrst question is ‘not often’. However, the same physics that determines
      the fall of marbles in oil also determines, for example, the behavior of fog droplets in air,
      of bacteria swimming in water [14], or of oil drops in the Millikan oil-drop experiment.
      The marble problem not only illustrates the physical principles, but also we can check our
      results with a home experiment.
      In slow, viscous ﬂows, the drag force comes directly from – surprise! – viscous forces. These
      forces are proportional to viscosity because viscosity is the constant of proportionality in
      the deﬁnition of the viscous force. Therefore

                                                   Fd ∝ ν.
```

The viscosity appears exactly once in the drag result, repeated here:

```
                                                        vr
                                      Fd = ρﬂ r2 v2 f      .
                                                        ν
```

To ﬂip ν into the numerator and make Fd ∝ ν, the function f must have the form f (x) ∼ 1/x. With this f (x) the result is

```
                                                    ν
                                    Fd ∼ ρﬂ r2 v2      = ρﬂ νv.
                                                    vr
```

Dimensional analysis alone is insufﬁcient to compute the missing magic dimensionless constant. A ﬂuid mechanician must do a messy and difﬁcult calculation. Her burden is light now that we have worked out the solution except for this one constant. The British mathematician Stokes, the ﬁrst to derive its value, found that

```
                                        Fd = 6πρﬂ νvr.
```

In honor of Stokes, this result is called Stokes drag. Let’s sanity check the result. Large or fast marbles should feel a lot of drag, so r and v should be in the numerator. Viscous ﬂuids should produce a lot of drag, so ν should be the numerator. The proposed drag force passes these tests. The correct location of the density – in the numerator or denominator – is hard to judge. You can make an educated judgment by studying the Navier–Stokes equations. In those equations, when v is ‘small’ (small compared to what?) then the (v·∇)v term, which contains two powers of v, becomes tiny compared to the viscous term ν∇2 v, which contains only one power of v. The second-order term arises from the inertia of the ﬂuid, so this term’s being small says that the oozing marble does not experience inertial effects. So perhaps ρﬂ , which represents the inertia of the ﬂuid, should not appear in the Stokes drag. On the other hand, viscous forces are proportional to the dynamic viscosity η = ρﬂ ν, so ρﬂ should appear even if inertia is unimportant. The Stokes drag passes this test. Using the dynamic instead of kinematic viscosity, the Stokes drag is

```
                                          Fd = 6πηvr,
```

often a convenient form because many tables list η rather than ν. This factor of 6π comes from doing honest calculations. Here, it comes from solving the Navier–Stokes equations. In this book we wish to teach you how not to suffer, so we do not solve such equations. We usually quote the factor from honest calculation to show you how accurate (or sloppy) the approximations are. The factor is often near unity, although not in this case where it is roughly 20! In fancy talk, it is usually ‘of order unity’. Such a number suits our neural hardware: It is easy to remember and to use. Knowing the approximate derivation and remembering this one number, you reconstruct the exact result without solving difﬁcult equations. Now use the Stokes drag to estimate the terminal velocity in the special case of low Reynolds number.

8.3.5 Terminal velocity for low Reynolds number

Having assembled all the pieces in the roadmap, we now return to the original problem of ﬁnding the terminal velocity. Since no net force

```
     acts on the marble (the deﬁnition of terminal velocity), the drag force    weight            drag
```

plus the buoyant force equals the weight:

```
                                                                                ρsp r3 g          DA            ρﬂ r 3 g
                             νρﬂ vr + ρﬂ gr3 ∼ ρobj gr3 .
                                 
                               Fd       Fb          Fg                                     group 1        group 2

     After rearranging:
                                                                                             vR             Fd
                                                                                              ν           ρﬂ r 2 v 2
                              νρﬂ vr ∼ (ρobj − ρﬂ )gr3 .

     The terminal velocity is then

                                                  gr2 ρobj
                                             v∼            −1 .
                                                   ν ρﬂ
```

In terms of the dynamic viscosity η, it is

```
                                                  gr2
                                             v∼       (ρobj − ρﬂ ).
                                                   η
```

This version, instead of having the dimensionless factor ρobj /ρﬂ − 1 that appears in the version with kinematic viscosity, has a dimensional ρobj − ρﬂ factor. Although it is less aesthetic, it is often more convenient because tables often list dynamic viscosity η rather than kinematic viscosity ν. We can increase our conﬁdence in this expression by checking whether the correct variables are upstairs (a picturesque way to say ‘in the numerator’) and downstairs (in the denominator). Denser marbles should fall faster than less dense marbles, so ρobj should live upstairs. Gravity accelerates marbles, so g should live upstairs. Viscosity slows marbles, so ν should live downstairs. The terminal velocity passes these tests. We therefore have more conﬁdence in our result, although the tests did not check the location of r or any exponents: For example, should ν appear as ν2 ? Who knows, but if viscosity matters, it mostly appears as a square root or as a ﬁrst power. To check r, imagine a large marble. It will experience a lot of drag and fall slowly, so r should appear downstairs. However, large marbles are also heavy and fall rapidly, which suggests that r should appear upstairs. Which effect wins is not obvious, although after you have experience with these problems, you can make an educated guess: weight scales as r3 , a rapidly rising function r, whereas drag is probably proportional to a lower power of r. Weight usually wins such contents, as it does here, leaving r upstairs. So the terminal velocity also passes the r test. Let’s look at the dimensionless ratio in parentheses: ρobj /ρﬂ − 1. Without buoyancy the −1 disappears, and the terminal velocity would be

```
     8 Special cases                                                                              81
                                                     ρobj
                                               v∝g          .
                                                      ρﬂ
```

We retain the g in the proportionality for the following reason: The true solution returns if we replace g by an effective gravity g where

```
                                                         ρﬂ
                                            g ≡ g 1 −        .
                                                         ρobj
```

So, one way to incorporate the effect of the buoyant force is to solve the problem without buoyancy but with the reduced g. Check this replacement in two limiting cases: ρﬂ = 0 and ρﬂ = ρobj . When ρobj = ρﬂ gravity vanishes: People, whose density is close to the density of water, barely ﬂoat in swimming pools. Then g should be zero. When ρﬂ = 0, buoyancy vanishes and gravity retains its full effect. So g should equal g. The effective gravity deﬁnition satisﬁes both tests. Between these two limits, the effective g should vary linearly with ρﬂ because buoyancy and weight superpose linearly in their effect on the object. The effective g passes this test as well. Another test is to imagine ρﬂ > ρobj . Then the relation correctly predicts that g is negative: helium balloons rise. This alternative to using buoyancy explicitly is often useful. If, for example you forget to include buoyancy (which happened in the ﬁrst draft of this chapter), you can correct the results later by replacing g with the g . If we carry forward the constants of proportionality, starting with the magic 6π in the Stokes drag and including the 4π/3 that belongs in the weight, we ﬁnd

```
                                               2 gr2 ρobj
                                          v∼              −1 .
                                               9 ν ρﬂ

8.3.6 Conductivity of seawater
```

As an application of Stokes drag and a rare example of a realis-

```
                                                                                         σ=
```

tic situation with low Reynolds numbers, let’s estimate the elec-

trical conductivity of seawater. Solving this problem is hopeless without breaking it into pieces. Conductivity σ is the reciprocal

of resistivity ρ. (Apologies for the convention that overloads the

```
                                                                                    R=         block geometry
```

density symbol with yet another meaning.) Resistivity, as its name

suggests, is related to resistance R. Why have both ρ and R? Re-

```
                                                                           V = El            I = qnvA
```

sistance is a useful measure for a particular wire, but not for wires

```
     in general because it depends on the diameter and cross-sectional E          l      n        v
```

area of the wire. It is not an intensive quantity. Before examin­

```
                                                                                            Fq        Fd
```

ing the relationship between resistivity and resistance, let’s ﬁnish sketching the solution tree, leaving ρ as depending on R plus geometry. We can ﬁnd R by placing a voltage V across a block of seawater and measuring the current I; then R = V/I. To ﬁnd V or I we need a physical model. First, why does seawater conduct at all? Conduction requires the transport of charge, which is produced by an electric ﬁeld. Seawater

is mostly water and table salt (NaCl). The ions that arise from dissolving salt can transport charge. The resulting current is

```
                                           I = qnvA,
```

where A is the cross-sectional area of the block, q is the ion charge, n is the ion concentration, and v is its terminal speed. To understand, and be able to rederive this formula, ﬁrst check its dimensions. Current is charge per time. Is the right side also charge per time? Yes: q takes care of the charge; and vA has dimensions of L3 T−1 so nvA, which has dimensions of T−1 , takes care of the time. As a second check, watch a cross-section of the block for a time Δt. How much charge ﬂows in that time? The charges move at speed v, so all charges in block of width vΔt and area A cross the cross-section. This block has volume vAΔt. The ion concentration is n, so the block contains nvAΔt charges. If each ion has charge q, then the total charge on the ions is Q = qnvAΔt. It took a time Δt for this charge to ﬂow, so the current is I = Q/Δt = qnvA. The terminal speed v depends on the applied force Fq and on the drag force Fd , just as for the falling marble but with an electrical force instead of a gravitational force. The result of this subdividing is the preceding map. Now let’s ﬁnd expressions for the unknown nodes. Only three remain: ρ, v, and n. The ﬁgure illustrates the relation between ρ and R:

```
                                                                                                     A
                                       RA
                                    ρ=    .
                                        l                                                 l
```

To ﬁnd v we follow the same procedure as for the marble. The applied force is Fq = qE, where q is the ion charge and E is the electric ﬁeld. The electric ﬁeld produced by the voltage V is E = V/l, where l is the length of the block, so

```
                                                   qV
                                            Fq =      ,
                                                    l
```

an expression in terms only of known quantities. The drag is Stokes drag. Equating this drag to the applied force gives the terminal velocity v in terms of known quantities:

```
                                                 qV
                                           v∼         ,
                                                6πηlr
```

where r is the radius of the ion. Only the number density n remains unknown. We estimate it after getting a symbolic result for σ, which you can do by climbing up the solution tree. First, ﬁnd the current in terms of the terminal velocity:

```
                                                    q2 nAV
                                      I = qnvA ∼           .
                                                     6πηlr

Use the current to ﬁnd the resistance:

                                              V 6πηlr
                                         R∼     ∼ 2    .
                                              I   q nA
```

The voltage V has vanished, which is encouraging: In most circuits the conductivity (and resistance) is independent of voltage. Use the resistance to ﬁnd the resistivity:

```
                                               A 6πηr
                                         ρ=R     ∼ 2 .
                                               l   q n
```

The expression simpliﬁes as we rise up the tree: The geometric parameters l and A have also vanished, which is also encouraging: The purpose of evaluating resistivity rather than resistance is that resistivity is independent of geometry. Use resistivity to ﬁnd conductivity:

```
                                              1   q2 n
                                         σ=     ∼      .
                                              ρ 6πηr
```

Here q is the electron charge e or its negative, depending on whether a sodium or a chloride ion is the charge carrier, so

```
                                              1   e2 n
                                         σ=     ∼      .
                                              ρ 6πηr
```

To ﬁnd σ still requires the ion concentration n, which we can ﬁnd from the concentration of salt in seawater. This value I estimate with a kitchen-sink experiment: Add table salt to a glass of water until it tastes as salty as seawater. I just tried it. In a glass of water, I found that a teaspoon of salt tastes very salty, like drinking seawater. A glass of water may have a volume of 0.3  or a mass of 300 g. A ﬂat teaspoon of salt has a volume of about 5 m. For those who live in metric countries, a teaspoon is an archaic measure used in Britain and especially the United States, which has no nearby metric country to which it pays attention. A teaspoon is about 4 cm long by 2 cm wide by 1 cm thick at its deepest point; let’s assume

### 0.5 cm on average. Its volume is therefore

```
                          teaspoon ∼ 4 cm × 2 cm × 0.5 cm ∼ 4 cm3 .
```

The density of salt is maybe twice the density of water, so a ﬂat teaspoon has a mass of ∼ 10 g. The mass fraction of salt in seawater is, in this experiment, roughly 1/30. The true value is remarkably close: 0.035. A mole of salt, which provides two charges per NaCl ‘molecule’, has a mass of 60 g, so

```
                        1              2 charges 6 · 1023 molecules mole−1
                  n∼      × 1 g cm−3 ×          ×
                       30    molecule                60 g mole−1
                                ρwater

                    ∼ 7 · 10 charges cm−3 .
                           20
```

With n evaluated, the only remaining mysteries in the conductivity

```
                                              1   q2 n
                                         σ=     ∼
                                              ρ 6πηr
```

are the ion radius r and the dynamic viscosity η. Do the easy part ﬁrst. The dynamic viscosity is

```
                  η = ρwater ν ∼ 103 kg m−3 × 10−6 m2 s−1 = 10−3 kg m−1 s−1 .
```

Here I switched to SI (mks) units. Although most calculations are easier in cgs units – also known as God’s units – than they are in SI units, the one exception is electromagnetism, which is represented by the e2 in the conductivity. Electromagnetism is conceptually easier in cgs units – which needs no ghastly μ0 or 4π0 , for example – than it is in SI units. However, the cgs unit of charge, the electrostatic unit, is unfamiliar. So, for numerical calculations, use SI units. The ﬁnal quantity required is the ion radius. A positive ion (sodium) attracts an oxygen end of a water molecule; a negative ion (chloride)

```
                                                                                        water
```

attracts the hydrogen end of a water molecule. Either way, the ion, being charged, is surrounded by one or maybe more layers of water molecules.

```
                                                                                water                water
```

As it moves, it drags some of this baggage with it. So rather than use the bare ion radius you should use a larger radius to include this shell. But how thick is the shell? As an educated guess, assume that the shell

includes one layer of water molecules, each with a radius of 1.5 Å. So for the ion plus shell, r ∼ 2 Å. With these numbers, the conductivity becomes:

```
                                            e2              n
                                                   
                                      (1.6 · 10 C)2 × 7 · 1026 m−3
                                               −19
                          σ∼                                           .
                               6 × 3 × 10−3 kg m−1 s−1 × 2 · 10−10 m
                                                
                                 6π              η               r
```

You can do the computation mentally: Take out the big part, apply the principle of maximal laziness, and divide and conquer by ﬁrst counting the powers of ten (shown in red) and then worrying about the small factors. Then divide and conquer again by counting the top and bottom contributions separately. The top contributes -12 powers of ten: −38 from e2 and +26 from n. The bottom contributes -13 powers of ten: −3 from η and −10 from r. The division produces one power of ten. Now account for the remaining small factors:

```
                                             1.62 × 7
                                                      .
                                             6×3×2
```

Slightly overestimate the answer by pretending that the 1.62 on top cancels the 3 on the bottom. Slightly underestimate the answer – and maybe compensate for the overestimate – by pretending that the 7 on top cancels the 6 on the bottom. After these lies, only 1/2 remains. Multiplying it by the sole power of ten gives

```
                                          σ ∼ 5 Ω−1 m−1 .
```

Using a calculator to do the arithmetic gives 4.977 . . . Ω−1 m−1 , which is extremely close to the result from mental calculation.

```
      8 Special cases                                                                              85

      The estimated resistivity is

                                        ρ ∼ σ−1 ∼ 0.2 Ω m = 20 Ω cm,

      where we converted to the conventional although not fully SI units of Ω cm. A typical
      experimental value for seawater at T = 15 ◦ C is 23.3 Ω cm (from [15, p. 14-15]), absurdly
      close to the estimate!
      Probably the most signiﬁcant error is the radius of the ion-plus-water combination that is
      doing the charge transport. Perhaps r should be greater than 2 Å, especially for a sodium
      ion, which is smaller than chloride; it therefore has a higher electric ﬁeld at its surface and
      grabs water molecules more strongly than chloride does. In spite of such uncertainties, the
      continuum approximation produced more accurate results than it ought to.
      At the length scale of a sodium ion, water looks like a collection of spongy boulders more
      than it looks like a continuum. Yet Stokes drag worked. It works because the important
      length scale is not the size of water molecules, but rather their mean free path between
      collisions. Molecules in a liquid are packed to the point of contact, so the mean free path is
      much shorter than a molecular (or even ionic) radius, especially compared to an ion with
      its shell of water.
      The moral of this example, besides illustrating Stokes drag, is to have courage. Approxi­
      mate ﬁrst and ask questions later. Maybe the approximations are correct for reasons that
      you do not suspect when you start solving a problem. If you agonize over each approxima­
      tion, you will never start a calculation, and then you will not ﬁnd out that many approxi­
      mations would have been ﬁne. . .if only you had had the courage to make them.

8.3.7 Turbulent limit

      We now compute drag in the other ﬂow extreme: high-speed, or turbulent, ﬂow. The exam­
      ple will be to compute the terminal speed of a raindrop. These results apply to most ﬂows.
      For example, when a child rises from a chair, the airﬂow around her is high-speed ﬂow, as
      you can check by computing the Reynolds number. Say that the child is 0.2 m wide, and
      that she rises with velocity 0.5 m s−1 . Then

                                             vr    0.5 m s−1 × 0.2 m
                                     Re ∼        ∼                   ∼ 5000.
                                            νair     2 · 10−5 m2 s−1
      Here viscosity of air is closer to

                                             νair ≈ 1.5 · 10−5 m2 s−1 ,

      than to 2 · 10−5 m2 s−1 , but 2 · 10−5 m2 s−1 easily combines with the 0.2 m in the numerator to
      allows us to do the calculation mentally. Using either value for the viscosity, the Reynolds
      number is much larger than unity, so the ﬂow is turbulent. Larger objects, such as planes,
      trains, and automobiles, create turbulence even when they travel even more slowly than
      the child. In short, most ﬂuid ﬂow around us is turbulent ﬂow.
```

To begin the analysis, we assume that a raindrop is a sphere. It is a convenient lie that allows us to reuse the general results of Section 8.3.3 and specialize to high-speed ﬂow. At high speeds (more precisely, at high Reynolds number) the ﬂow is turbulent. Viscosity – which affects only slow ﬂows but does not directly inﬂuence the shearing and whirling of turbulent ﬂows – becomes irrelevant. Let’s see how much we can understand about turbulent drag knowing only that turbulent drag is nearly independent of viscosity. Turbulence is perhaps the main unsolved problem in classical physics. However, you can still understand a lot about drag using dimensional analysis plus a bit of physical reasoning; we do not need a full understanding of turbulence. The world is messy: Do not wait for a full understanding before you analyze or estimate.

```
In the roadmap for low Reynolds number, the viscosity ap-     Var  Dim
pears only in the ﬁrst group. Because turbulent drag is in-   Fd  MLT−2
dependent of the viscosity, the viscosity disappears from     ρﬂ  ML−3
the results and therefore so does that group. This argu­       r     L
```

ment is glib. More precisely, remove ν from the list of vari­  v  LT−1 ables and search again for dimensionless groups. The remaining four variables, shown in the table, result in one dimensionless group, which is the second group from the old roadmap. So the Reynolds number, which was the ﬁrst group, has disappeared from the analysis. But why is drag at high speeds independent of Reynolds number? Equivalently, why can we remove ν from the list of variables and still get the correct form for the drag force? The answer is not obvious. The explanation of the Reynolds number as a ratio of two speeds v and V provides a partial answer. A natural length in this problem is r; we can use r to transform v and V into times:

```
                                             r
                                        τv ≡ ,
                                             v
                                             r  r2
                                        τV ≡   ∼ .
                                             V  ν
```

Note that Re ≡ τV /τv . The quantity τv is the time that ﬂuid takes to travel around the sphere (apart from constants). Kinematic viscosity is ν/ρ, but its most important interpretation is as the diffusion coefﬁcient for momentum. So the time for momentum to diffuse a distance x is

```
                                                x2
                                           τ∼      .
                                                ν
```

This result depends on the mathematics of random walks; you can increase your conﬁdence in it here, without understanding the theory of random walks, by checking that it has valid dimensions. And it has: Each side is a time. So τV is the time that momentum takes to diffuse around an object of size r, such as the falling sphere in this problem. If τV  τv – in which case Re  1 – then momentum diffuses before ﬂuid travels around the sphere. Momentum diffusion equalizes velocities, if it has time, which it does have in this low-Reynolds-number limit. Momentum diffusion

therefore prevents ﬂow at the front from being radically different from the ﬂow at the back, and thereby squelches any turbulence. In the other limit, when τV  τv or Re  1 – momentum diffusion is outraced by ﬂuid ﬂow, so the ﬂuid is free to shred itself into a turbulent mess. Once the viscosity is low enough to allow turbulence, its value does not affect the drag, which is why we can ignore it for Re  1. Here Re  1 means ‘large enough so that turbulence sets in’, which happens around Re ∼ 1000. A more complete story, which we discuss as part of boundary layers in Section 9.4, slightly corrects this approximation. However, it is close enough for our purposes here. Here the important point is that the viscosity vanishes from the analysis and so does group 1. Once it disappears, the dimensionless group

```
that remains is                                                              weight            drag

                                       Fd
                              G2 =            .
                                     ρﬂ r2 v2                                 ρsp r3 g          DA                  ρﬂ r 3 g
```

Because it is the only group, the solution is

```
                                                                                              group

                      G2 = dimensionless constant,
                                                                                                Fd
or                                                                                            ρﬂ r 2 v 2

                               Fd ∼ ρﬂ r2 v2 .
```

This drag is for a sphere. What about other shapes, which are characterized by more parameters than a sphere is? So that the drag force generalizes to more complex shapes, we express it using the cross-sectional area of the object. Here A = πr2 , so

```
                                                                                                             ﬂuid
                                      Fd ∼ ρﬂ Av2 .
                                                                                                                               h
```

This conventional choice has a physical basis. As an object moves, the mass of ﬂuid

```
                                                                                                           m = ρﬂ Ah
```

that it displaces is proportional to its cross-sectional area:

```
                                      mﬂ = ρﬂ Ah.
```

The ﬂuid is given a speed comparable to v, so the ﬂuid’s kinetic energy is

```
                                   1       1
                               EK ∼ mﬂ v2 ∼ ρﬂ Ahv2 .
                                   2       2
```

If all this kinetic energy is dissipated by drag, then the drag force is EK /h or

```
                                              1
                                          Fd ∼ ρﬂ Av2 .
                                              2
```

In this form with the factor of 1/2, the constant of proportionality is the drag coefﬁcient cd .

```
Like its close cousin f from the dimensionless drag force, the drag coefﬁcient    Object
is a dimensionless measure of the drag force. It depends on the shape of the      Sphere
```

object – on how streamlined it is. The table lists cd for various shapes (at high Cylinder

```
Reynolds number). The drag coefﬁcient, being proportional to the function         Flat plate
 f (Re) in the general solution, also depends on the Reynolds number. How-        Car
```

ever, using the reasoning that the ﬂow at high Reynolds number is independent of viscosity, the drag coefﬁcient should also be independent of Reynolds number. Using the drag coefﬁcient instead of f (which implies using cross-sectional area instead of r2 ), the turbulent drag force becomes

```
                                             1
                                         Fd = cd ρﬂ v2 A.
                                             2
```

So we have an expression for the turbulent drag force. The weight and buoyant forces are the same as in the viscous limit. So we just need to redo the analysis of the viscous limit but with the new drag force. Because the weight and buoyant forces contain r3 , we return to using r2 instead of A in the drag force. With these results, the terminal velocity v is given by

```
                                     ρﬂ r2 v2 ∼ g(ρobj − ρﬂ )r3 ,
                                                      
                                       Fd             Fg −Fb

so
                                            
                                                     ρobj
                                       v∼       gr          −1 .
                                                     ρﬂ
```

Pause to sanity check this result: Are the right variables upstairs and downstairs? We consider each variable in turn.

- ρﬂ : The terminal velocity is smaller in a denser ﬂuid (try running in a swimming pool),
so ρﬂ should be in the denominator.

```
•    g: Imagine a person falling on a planet that has a gravitational force stronger than that of
```

the earth. Gravity partially determines atmospheric pressure and density. Holding the atmospheric density constant while increasing gravity might be impossible in real life, but we can do it easily in a thought experiment. The drag force then does not depend on g, so gravity increases the terminal speed without opposition from the drag force: g should be upstairs.

- ρobj : Imagine a raindrop made of (very) heavy water. Relative to a standard raindrop,
the gravitational force increases while the drag force remains constant, as shown using the ﬂuid-is-a-computer argument in ??sec:drag-force-DA. So ρobj should be upstairs.

- r: To determine where the radius lives requires a more subtle argument. Increasing r
increases both the gravitational and drag forces. The gravitational force increases as r3

whereas the drag force increases only as r2 . So, for larger raindrops, their greater weight increases v more than their greater drag decreases v. Therefore r should be live upstairs.

- ν: At high Reynolds number viscosity does not affect drag, at least not in our approxi­
mation. So ν should not appear anywhere.

The terminal velocity passes all tests. Now we can compute the terminal velocity. The splash spots on the sidewalk made by raindrops in a recent rain have r ∼ 0.3 cm. Since rain is water, its density is ρobj ∼ 1 g cm−3 . The density of air is ρﬂ ∼ 1 kg m−3 , so ρﬂ  ρobj : Buoyancy is therefore not an important effect, and we can replace ρobj /ρﬂ − 1 by ρobj /ρﬂ . With this simpliﬁcation and the estimated numbers, the terminal velocity is:

```
                                                      ρobj
                                                    
                         ⎛                              −3
                                                             ⎞1/2
                         ⎜⎜⎜                      1 g cm   ⎟
                                                           ⎟⎟⎟ ∼ 5 m s−1 ,
                    v ∼ ⎝⎜ 1000 cm s−2 × 0.3 cm × −3
                                 10 g cm−3 ⎠
                                g           r      
                                                      ρﬂ
```

or 10 mph. This calculation assumed that Re  1. Check that assumption! You need not calculate Re from scratch; rather, scale it relative to a previous results. As we worked out earlier, a child (r ∼ 0.2 m) rising from her chair (v ∼ 0.5 m s−1 ) creates a turbulent ﬂow with Re ∼ 5000. The ﬂow created by the raindrop is faster by a factor of 10, but the raindrop is smaller by a factor of roughly 100. Scaling the Reynolds number for the child gives

```
                                             vdrop    rdrop
                            Re ∼ Re child ×         ×        ∼ 500.
                                         vchild   rchild
                                  5000           
                                              10        0.01
```

This Reynolds number is also much larger than 1, so the ﬂow produced by the raindrop is turbulent, which vindicates the initial assumption.

```
Now that we have found the terminal velocity, let’s extract the pat-   Assume
```

tern of the solution. The order that we followed was assume, derive,

```
                                                                       Re  1           Fd ∼ ρv 2 R2
```

calculate, then check. This order is more fruitful than is the sim­

```
pler order of derive then calculate. Without knowing whether the           4
```

ﬂow is fast or slow, we cannot derive a closed-form expression for

```
                                                                           vR     3              ρobj
Fd ; such a derivation is probably beyond present understanding of    Re ∼            v ∼
                                                                             ν                    ρﬂ
ﬂuids and turbulence. Blocked by this mathematical Everest, we         Check
```

would remain trapped in the derive box. We would never determine Fd , so we would never realize that the Reynolds number is large (the assume box); however, only this assumption makes it possible to eliminate ν and thereby to estimate Fd . The moral: Assume early and often!

8.3.8 Combining solutions from the two limits

You know know the drag force in two extreme cases, viscous and turbulent drag. The results are repeated here:

```
                                      6πρﬂ νvr    (viscous),
                                Fd = 1
                                      2 cd ρﬂ Av
                                                2 (turbulent).
```

Let’s compare and combine them by making the viscous form look like the turbulent form. Compared to the turbulent form, the viscous form lacks one power of r and one power of v but has an extra power of ν. A combination of variables with a similar property is the Reynolds number rv/ν. So multiply the viscous drag by a useful form of unity:

```
                               rv/ν                  1
                       Fd =         × 6πρﬂ vρﬂ νr =    6πρﬂ v2 r2        (viscous).
                                   
                                Re                  Re
                                            Fd
                                1
```

This form, except for the 6π and the r2 , resembles the turbulent drag Fortunately A = πr2 so

```
                                             6
                                     Fd =      ρﬂ v2 A      (viscous),
                                            Re
     With
                                                 12
                                        cd =             (viscous),
                                                 Re
```

the turbulent drag and this rewritten viscous drag for a sphere have the same form:

```
                                                  ⎧
                                                  ⎪
                                                  ⎪ 12
                                                  ⎪
                                        1      2  ⎨ Re (Re  1),
                                                  ⎪
                                   Fd = ρﬂ Av × ⎪ ⎪
                                        2         ⎪
                                                  ⎪
                                                  ⎩ 0.5 (Re  1).
```

At high Reynolds number the drag coefﬁcient remains cd constant. For a sphere, that constant is cd ∼ 1/2. If the

```
                                                                                Re
```

low-Reynolds-number approximation for cd is valid at sufﬁciently high Reynolds numbers, then cd would cross

```
                                                                    100
```

1/2 near Re ∼ 24, where presumably the high-Reynoldsnumber approximation takes over. The crossing point is a reasonable estimate for the transition between low-

```
     and high-speed ﬂow. Experiment or massive simulation             1
```

are the only ways to get a more accurate result. Exper­

```
                                                                          0.01     1      100      104
```

imental data place the crossover near Re ∼ 5, at which point cd ∼ 2. Why can’t you calculate this value analytically? If a dimensionless variable, such as the Reynolds number, is close to unity, calculations become difﬁcult. Approximations that depend on a quantity being either huge or tiny are no longer valid. When all terms in an equation are roughly of the same magnitude, you cannot get rid of any term without making large errors. To get results in these situations, you have to do honest work: You must do experiments or solve the Navier–Stokes equations numerically.

## 9. Discretization

### 9.1 Diaper usage

### 9.2 Pendulum period

### 9.3 Random walks

Random walks are everywhere. Do you remember the card game War? How long does it last, on average? A molecule of neurotransmitter is released from a vesicle. Eventually it binds to the synapse, and your leg twitches. How long does it take to get there? On a winter day, you stand outside wearing only a thin layer of clothing. Why do you feel cold? These physical situations are examples of random walks. In a physical random walk, for example a gas molecule moving and colliding, the walker moves a variable distance and can move in any direction. This general situation is complicated. Fortunately, the essential features of the random walk do not depend on these complicated details. Simplify by discarding the generality. The generality arises from the continuous degrees of freedom: the direction is continuous and the distance between collisions is continuous. So, discretize the direction and the distance: Assume that the particle travels a ﬁxed distance between collisions and that it can move only along the coordinate axes. Furthermore, analyze the special case of one-dimensional motion before going to the more general cases of two- and three-dimensional motion. In this discretized, one-dimensional model, a particle starts at the origin and moves along a line. At each tick it moves left or right with probability 1/2 in each direction. Let the position after n steps be xn , and the expected position after n steps be xn . Because the random walk is unbiased – because moving in each direction is equally likely – the expected position remains constant:

```
                                           xn = xn−1 .
```

So x , the so-called ﬁrst moment of the position, is an invariant. However, it is not a fascinating invariant because it does not tell us much that we do not already understand intuitively.

Given that the ﬁrst moment is not interesting, try the next-most-complicated moment: the second moment x2 . This analysis is easiest in special cases. Suppose that after a while wandering, the particle has arrived at 7, i.e. x = 7. At the next tick it will be at either x = 6 or x = 8. Its expected squared position – not its squared expected position! – has become

```
                                              1 2
                                      x2 =      6 + 82 = 50.
                                              2
```

The expected squared position increased by 1. Let’s check this pattern in a second example. Suppose that the particle is at x = 10, so x2 = 100. After one tick, the new expected squared position is

```
                                            1 2
                                    x2 =      9 + 112 = 101.
                                            2
```

Yet again x2 has increased by 1! Based on those two examples, the conclusion is that

```
                                           x2n+1 = x2n + 1.

In other words,

                                               x2n = n.
```

Since each step takes a constant time, in this discretized analysis, the conclusion is that

```
                                               x2n ∝ t.
```

The result that x2 is proportional to time applied to the one-dimensional random walk. And it works for any dimension. Here’s an example in two dimensions. Suppose that the particle’s position is (5, 2), so x2 = 29. After one step, it has four equally likely positions:

```
                                                              (5, 2)

                                                r

                                  (0, 0)
```

Rather than compute the new expected squared distance using all four positions, be lazy and just look at the two horizontal motions. The two possibilities are (6, 2) and (4, 2). The expected squared distance is

```
                                          1
                                      x2 = (40 + 20) = 30,
                                          2
```

which is one more than the previous value of x2 . Since nothing is special about horizontal motion compared to vertical motion – symmetry! – the same result holds for vertical motion. So, averaging over the four possible locations produces an expected squared distance of 30. For two dimensions, the pattern is:

```
     9 Discretization                                                                              93

                                              x2n+1 = x2n + 1.
```

No step in the analysis depended on being in only two dimensions. In fancy words, the derivation and the result are invariant to change of dimensionality. In plain English, this result also works in three dimensions.

9.3.1 Difference between a random walk and a regular walk

In a standard walk in a straight line, x ∝ time. Note the single power of x. The interesting quantity in a regular walk is not x itself, since it can grow without limit and is not invariant, but the ratio x/t, which is invariant to changes in t. This invariant is also known as the speed. In a random walk, where x2 ∝ t, the interesting quantity is x2 /t. The expected squared position is not invariant to changes in t, but the ratio x2 /t is an invariant. This invariant is, except for a dimensionless constant, the diffusion constant often denoted D. It has dimensions of L2 T−1 . The difference between a random and a regular walk makes intuitive sense. A random walker, for example a gas molecule or a very drunk person, moves back and forth, sometimes making progress in one direction, and other times undoing that progress. So a random walker should take longer than a regular walker would take to travel the same distance. The relation x2 /t ∼ D conﬁrms and sharpens this intuition. The time for a random walker to travel a distance l is t ∼ l2 /D, which grows quadratically rather than linearly with distance.

9.3.2 Diffusion equation

The discretized model of a random explains where the diffusion equation comes from. Imagine a gas of particles with each particle doing a random walk in one dimension. How does the concentration, or number, change with time? Slice the one-dimensional world into slices of width Δx, and look at the slices at x − Δx, x, and x + Δx. In every time step, one-half the molecules in each slice move left, and one-half move right. So the number at x changes from N(x) to

```
                                        1
                                          (N(x − Δx) + N(x + Δx)),
                                        2
     for a change of
                                    1
                                ΔN = (N(x − Δx) + N(x + Δx)) − N(x)
                                    2
                                    1
                                   = (N(x − Δx) − 2N(x) + N(x + Δx)).
                                    2
     This last relation can be rewritten as

                            ΔN ∼ (N(x + Δx) − N(x)) − (N(x) − N(x + Δx)) ,

     which in terms of derivatives is

                                                           ∂2 N
                                             ΔN ∼ (Δx)2         .
                                                           ∂x 2
```

The slices are separated by a distance such that most of the molecules travel from one piece to the neighboring piece in the time step τ. If τ is the time between collisions – the mean free time – then the distance is the mean free path λ. Thus

```
                                              ΔN λ2 ∂2 N
                                                 ∼       ,
                                               τ   τ ∂x2
     or

                                                         ∂2 N
                                                Ṅ ∼ D
                                                         ∂x2
```

where D ∼ λ2 /τ is a diffusion constant. This partial-differential equation has interesting properties. The second spatial derivative means that a linear spatial concentration gradient remains unchanged: Its second derivative is zero so its time derivative must be zero. Diffusion smashes only curvature – roughly speaking, the second derivative – and does not try to change just the gradient. Heat often diffuses by a random walk, either via phonons (in a liquid or solid) or via molecular random walks (in a gas), so if you maintain one end of a bar at T1 and the other end at T2 , then the bar will eventually linearly interpolate between the two temperatures, as long as heat is fed into the hot end and drawn out of the cold end.

9.3.3 Keeping warm

One consequence of random walks is how to keep warm on a cold day. We need to calculate the ﬂux of heat: the energy ﬂowing per unit area per unit time. We start from the deﬁnition of ﬂux and reason physically. Flux of stuff is deﬁned as

```
                                                            stuff
                                        ﬂux of stuff =               .
                                                         area × time
```

The ﬂux depends on the density of stuff and on how fast the stuff travels:

```
                                                      stuff
                                    ﬂux of stuff =          × speed.
                                                     volume
```

You can check that the dimensions are the same on both sides. For heat ﬂux, the stuff is thermal energy. The speciﬁc heat cp is the thermal energy per mass, and ρcp T is the thermal energy per volume. The speed is the ‘speed’ of diffusion. To diffuse a distance l takes time t ∼ l2 /D, making the speed l/t or D/l. The l in the denominator indicates that, as expected, diffusion is slow over long distances. For heat diffusion, the diffusion constant is denoted κ and called the thermal diffusivity. So the speed is l/κ. Combine the thermal energy per volume with the diffusion speed:

```
                                                               κ
                                  thermal ﬂux = ρcp T ×          .
                                                               l
```

The product ρcp κ occurs so frequently that it is given a name: the thermal conductivity K. And the ratio T/l is a discretized version of the temperature gradient ΔT/Δx. With those substitutions, the thermal ﬂux is

```
                                                 ΔT
                                           F=K      .
                                                 Δx
```

To estimate how much heat one loses on a cold day, we need to estimate K = ρcp κ. Time to put all the pieces together for air:

```
                                     ρ ∼ 1 kg m−3 ,
                                     cp ∼ 103 J kg−1 K−1 ,
                                     κ ∼ 1.5 · 10−5 m2 s−1 ,
```

where we are guessing that κ = ν, since both are diffusion constants. Then

```
                                 K = ρcp κ ∼ 0.02 W m−1 K−1 .
```

Now we can estimate the heat loss outside on a cold day. Let’s say that your skin is at 30 ◦ C and the air outside is 0 ◦ C, so ΔT = 30 K. A thin T-shirt may have thickness 2 mm, so

```
                          ΔT                        30 K
                   F=K       ∼ 0.02 W m−1 K−1 ×            ∼ 300 W m−2 .
                          Δx                    2 · 10−3 m
```

Damn, I wanted a power not a power per area. Oh, ﬂux is power per area, so all is well. I just need to multiply by my surface area. I’m roughly 2 m tall (approximately!) and 0.5 m wide, so my front and back each have area 1 m2 . Then

```
                            P ∼ FA = 300 W m−2 × 2 m2 = 600 W.
```

No wonder it feels so cold! Just sitting around, your body generates 100 W (the basal metabolic rate). So, with 600 W escaping, you lose far more heat more than you generate. After long enough, your core body temperature drops. Chemical reactions in your body slow down, because all reactions go slower at lower temperature, and because enzymes lose their optimized shape. Eventually you die. One solution is jogging to generate extra heat. That solution indicates that the estimate of 600 W is plausible. Cycling hard, which generates hundreds of watts of waste heat, is vigorous enough exercise to keep you warm, even on a winter day in thin clothing. Another simple solution, as parents repeat to their children: Dress warmly by putting on thick layers. Let’s recalculate the power loss if you put on a ﬂeece that is 2 cm thick. You could redo the whole calculation from scratch, but it is simpler is to notice that the thickness has gone up by a factor of 10. Since F ∝ 1/Δx, the ﬂux and the power drop by a factor of 10. So, when wearing the ﬂeece,

```
                                           P ∼ 60 W.
```

That heat loss is smaller than the basal metabolic rate, which indicates that you do not feel too cold. Indeed, when wearing a thick ﬂeece, you feel most cold in your hands and face. Those regions are exposed to the air, and are protected by only a thin layer of still air. Because a small Δx means a large heat ﬂux, the moral is: Listen to your parents, bundle up!

### 9.4 Boundary layers

## 10. Springs

```
       Everything is a spring! The main example in this chapter is waves, which illustrate springs,
       discretization, and special cases – a ﬁtting, uniﬁed way to end the book.
```

### 10.1 Waves

```
       Ocean covers most of the earth, and waves roam most of the ocean. Waves also cross pud­
       dles and ponds. What makes them move, and what determines their speed? By applying
       and extending the techniques of approximation, we analyze waves. For concreteness, this
       section refers mostly to water waves but the results apply to any ﬂuid. The themes of
       section are: Springs are everywhere and Consider limiting cases.

10.1.1 Dispersion relations

       The most organized way to study waves is to use dispersion relations. A dispersion re­
       lation states what values of frequency and wavelength a wave can have. Instead of the
       wavelength λ, dispersion relations usually connect frequency ω, and wavenumber k, which
       is deﬁned as 2π/λ. This preference has an basis in order-of-magnitude reasoning. Wave­
       length is the the distance the wave travels in a full period, which is 2π radians of oscillation.
       Although 2π is dimensionless, it is not the ideal dimensionless number, which is unity. In
       1 radian of oscillation, the wave travels a distance
                                                           λ
                                                   λ̄ ≡      .
                                                          2π
       The bar notation, meaning ‘divide by 2π’, is chosen by analogy with h and �. The one-
       radian forms such as � are more useful for approximations than the 2π-radian forms. The
       Bohr radius, in a form where the dimensionless constant is unity, contains � rather than h.
       Most results with waves are similarly simpler using λ̄ rather than λ. A further reﬁnement
       is to use its inverse, the wavenumber k = 1/λ̄. This choice, which has dimensions of inverse
       length, parallels the deﬁnition of angular frequency ω, which has dimensions of inverse
       time. A relation that connects ω and k is likely to be simpler than one connecting ω and λ̄,
       although either is simpler than one connecting ω and λ.
       The simplest dispersion relation describes electromagnetic waves in a vacuum. Their fre­
       quency and wavenumber are related by the dispersion relation

                                                     ω = ck,

       which states that waves travel at velocity ω/k = c, independent of frequency. Dispersion
       relations contain a vast amount of information about waves. They contain, for example,
       how fast crests and troughs travel: the phase velocity. They contain how fast wave packets
       travel: the group velocity. They contain how these velocities depend on frequency: the
       dispersion. And they contain the rate of energy loss: the attenuation.

10.1.2 Phase and group velocities

       The usual question with a wave is how fast it travels. This question has two answers, the
       phase velocity and the group velocity, and both depend on the dispersion relation. To get
       a feel for how to use dispersion relations (most of the chapter is about how to calculate
       them), we discuss the simplest examples that illustrate these two velocities. These analyses
       start with the general form of a traveling wave:

                                              f (x, t) = cos(kx − ωt),

       where f is its amplitude.
       Phase velocity is an easier idea than group          0          1
       velocity so, as an example of divide-and­
                                                   t = t1 :                               cos(kx − ωt1 )
       conquer reasoning and of maximal lazi­                 0           1

       ness, study it ﬁrst. The phase, which is t = t2 :                                  cos(kx − ωt2 )
       the argument of the cosine, is kx − ωt. A
       crest occurs when the phase is zero. In
       the top wave, a crest occurs when x = ωt1 /k. In the bottom wave, a crest occurs when
       x = ωt2 /k. The difference
                                                    ω
                                                      (t2 − t1 )
                                                    k
       is the distance that the crest moved in time t2 −t1 . So the phase velocity, which is the velocity
       of the crests, is
                                              distance crest shifted ω
                                      vph =                         = .
                                                   time taken        k
       To check this result, check its dimensions: ω provides inverse time and 1/k provides length,
       so ω/k is a speed.
       Group velocity is trickier. The word ‘group’ suggests that the concept involves more than
       one wave. Because two is the ﬁrst whole number larger than one, the simplest illustration
       uses two waves. Instead of being a function relating ω and k, the dispersion relation here is
       a list of allowed (k, ω) pairs. But that form is just a discrete approximation to an ofﬁcial dis­
       persion relation, complicated enough to illustrate group velocity and simple enough to not
       create a forest of mathematics. So here are two waves with almost the same wavenumber
       and frequency:

                               f1 = cos(kx − ωt),
                               f2 = cos((k + Δk)x − (ω + Δω)t),
```

where Δk and Δω are small changes in wavenumber and frequency, respectively. Each wave has phase velocity vph = ω/k, as long as Δk and Δω are tiny. The ﬁgure shows their sum.

```
                                    A                       x
                                    +
                                    B                       x

                                    =                       x
```

The point of the ﬁgure is that two cosines with almost the same spatial frequency add to produce an envelope (thick line). The envelope itself looks like a cosine. After waiting a while, each wave changes because of the ωt or (ω + Δω)t terms in their phases. So the sum and its envelope change to this:

```
                                    A                       x
                                    +
                                    B                       x

                                    =                       x
```

The envelope moves, like the crests and troughs of any wave. It is a wave, so it has a phase velocity, which motivates the following deﬁnition:

```
                      Group velocity is the phase velocity of the envelope.
```

With this pictorial deﬁnition, you can compute group velocity for the wave f1 + f2 . As suggested in the ﬁgures, adding two cosines produces a a slowly varying envelope times a rapidly oscillating inner function. This trigonometric identity gives the details:

```
                                             B−A        A+B
                         cos(A + B) = 2 cos       × cos     .
                                               2         2
                                                 
                                            envelope         inner
```

If A ≈ B, then A − B ≈ 0, which makes the envelope vary slowly. Apply the identity to the sum:

```
                     f1 + f2 = cos(kx − ωt) + cos((k + Δk)x − (ω + Δω)t).
                                                              
                                        A                       B

Then the envelope contains

                                    B−A       xΔk − tΔω
                              cos       = cos           .
                                     2            2
```

The envelope represents a wave with phase

```
                                                Δk    Δω
                                                   x−    t.
                                                2      2
      So it is a wave with wavenumber Δk/2 and frequency Δω/2. The envelope’s phase velocity
      is the group velocity of f1 + f2 :
                                           frequency   Δω/2 Δω
                                   vg =              =      =    .
                                          wavenumber   Δk/2   Δk
      In the limit where Δk → 0 and Δω → 0, the group velocity is
                                                        ∂ω
                                                 vg =      .
                                                        ∂k
      It is usually different from the phase velocity. A typical dispersion relation, which appears
      several times in this chapter, is ω ∝ kn . Then vph = ω/k = kn−1 and vg ∝ nkn−1 . So their ratio
      is
                                  vg
                                       = n.    (for a power-law relation)
                                 vph

      Only when n = 1 are the two velocities equal. Now that we can ﬁnd wave velocities from
      dispersion relations, we return to the problem of ﬁnding the dispersion relations.

10.1.3 Dimensional analysis

      A dispersion relation usually emerges from solving a wave equation, which is an unpleas­
      ant partial differential equation. For water waves, a wave equation emerges after lineariz­
      ing the equations of hydrodynamics and neglecting viscosity. This procedure is mathemat­
      ically involved, particularly in handling the boundary conditions. Alternatively, you can
      derive dispersion relations using dimensional analysis, then complete and complement the
      derivation with physical arguments. Such methods usually cannot evaluate the dimen­
      sionless constants, but the beauty of studying waves is that, as in most problems involving
      springs and oscillations, most of these constants are unity.
      How do frequency and wavenumber connect? They have dimensions of T−1 and L−1 , re­
      spectively, and cannot form a dimensionless group without help. So include more vari­
      ables. What physical properties of the system determine wave behavior? Waves on the
      open ocean behave differently from waves in a bathtub, perhaps because of the difference
      in the depth of water h. The width of the tub or ocean could matter, but then the prob­
      lem becomes two-dimensional wave motion. In a ﬁrst analysis, avoid that complication
      and consider waves that move in only one dimension, perpendicular to the width of the
      container. Then the width does not matter.
      To determine what other variables are important, use the principle that waves are like
      springs, because every physical process contains a spring. This blanket statement cannot be
      strictly correct. However, it is useful as a broad generalization. To get a more precise
      idea of when this assumption is useful, consider the characteristics of spring motion. First,
      springs have an equilibrium position. If a system has an undisturbed, resting state, con­
      sider looking for a spring. For example, for waves on the ocean, the undisturbed state is a
```

calm, ﬂat ocean. For electromagnetic waves – springs are not conﬁned to mechanical systems – the resting state is an empty vacuum with no radiation. Second, springs oscillate. In mechanical systems, oscillation depends on inertia to carry the mass beyond the equilibrium position. Equivalently, it depends on kinetic energy turning into potential energy, and vice versa. Water waves store potential energy in the disturbance of the surface and kinetic energy in the motion of the water. Electromagnetic waves store energy in the electric and magnetic ﬁelds. A magnetic ﬁeld is generated by moving or spinning charges, so the magnetic ﬁeld is a reservoir of kinetic (motion) energy. An electric ﬁeld is generated by stationary charges and has an associated potential, so the electric ﬁeld is the reservoir of potential energy. With these identiﬁcations, the electromagnetic ﬁeld acts like a set of springs, one for each radiation frequency. These examples are positive examples. A negative example – a marble oozing its way through glycerin – illustrates that springs are not always present. The marble moves so slowly that the kinetic energy of the corn syrup, and therefore its inertia, is miniscule and irrelevant. This system has no reservoir of kinetic energy, for the kinetic energy is merely dissipated, so it does not contain a spring. Waves have the necessary reservoirs to act like springs. The surface of water is ﬂat in its lowest-energy state. Deviations, also known as waves, are opposed by a restoring force. Distorting the surface is like stretching a rubber sheet: Surface tension resists the distortion. Distorting the surface also requires raising the average water level, a change that gravity resists. The average height of the surface does not change, but the average depth of the water does. The higher column, under the crest, has more water than the lower column, under the trough. So in averaging to ﬁnd the average depth, the higher column gets a slightly higher weighting. Thus the average depth increases. This result is consistent with experience: It takes energy to make waves. The total restoring force includes gravity and surface tension so, in the list of variables, include surface tension (γ) and gravity (g). In a wave, like in a spring, the restoring force ﬁghts inertia, represented here by the ﬂuid density. The gravitational piece of the restoring force does not care about density: Gravity’s stronger pull on denser substances is exactly balanced by their greater inertia. This exact cancellation is a restatement of the equivalence principle, on which Einstein based the theory of general relativity [16, 17]. In pendulum motion, the mass of the bob drops out of the ﬁnal solution for the same reason. The surface-tension piece of the restoring force, however, does not change when density changes. The surface tension itself, the ﬂuid property γ, depends on density because it depends on the spacing of atoms at the surface. That dependence affects γ. However, once you know γ you can compute surface-tension forces without knowing the density. Since ρ does not affect the surface-tension force but affects the inertia, it affects the properties of waves in which surface tension provides a restoring force. Therefore, include ρ in the list.

```
To simplify the analysis, assume that the waves do not lose       Var     Dim
energy. This choice excludes viscosity from the set of vari­       ω      T−1
ables. To further simplify, exclude the speed of sound. This       k      L−1
approximation means ignoring sound waves, and is valid as          g     LT−2
long as the ﬂow speeds are slow compared to the speed of           h       L
sound. The resulting ratio,                                        ρ     ML−3
                            ﬂow speed                              γ     MT−2     surface tension
                     M≡                ,
                           sound speed
```

is dimensionless and, because of its importance, is given a name: the Mach number. Finally, assume that the wave amplitude ξ is small compared to its wavelength and to the depth of the container. The table shows the list of variables. Even with all these restrictions, which signiﬁcantly simplify the analysis, the results explain many phenomena in the world. These six variables built from three fundamental dimensions produce three dimensionless groups. One group is easy: the wavenumber k is an inverse length and the depth h is a length, so

```
                                           Π1 ≡ kh.
```

This group is the dimensionless depth of the water: Π1  1 means shallow and Π1  1 means deep water. A second dimensionless group comes from gravity. Gravity, represented by g, has the same dimensions as ω2 , except for a factor of length. Dividing by wavenumber ﬁxes this deﬁcit:

```
                                                  ω2
                                           Π2 =      .
                                                  gk
```

Without surface tension, Π1 and Π2 are the only dimensionless groups, and neither group contains density. This mathematical result has a physical basis. Without surface tension, the waves propagate because of gravity alone. The equivalence principle says that gravity affects motion independently of density. Therefore, density cannot – and does not – appear in either group. Now let surface tension back into the playpen of dimensionless groups. It must belong in the third (and ﬁnal) group Π3 . Even knowing that γ belongs to Π3 still leaves great freedom in choosing its form. The usual pattern is to ﬁnd the group and then interpret it, as we did for Π1 and Π2 . Another option is to begin with a physical interpretation and use the interpretation to construct the group. Here you can construct Π3 to measure the relative importance of surface-tension and gravitational forces. Surface tension γ has dimensions of force per length, so producing a force requires multiplying by a length. The problem already has two lengths: wavelength (represented via k) and depth. Which one should you use? The wavelength probably always affects surface-tension forces, because it determines the curvature of the surface. The depth, however, affects surface-tension forces only when it becomes comparable to or smaller than the wavelength, if even then. You can use both

```
                                                   √
```

lengths to make γ into a force: for example, F ∼ γ h/k. But the analysis is easier if you use only one, in which case the wavelength is the preferable choice. So Fγ ∼ γ/k. Gravitational force, also known as weight, is ρg × volume. Following the precedent of using only k to produce a length, the gravitational force is Fg ∼ ρg/k3 . The dimensionless group is then the ratio of surface-tension to gravitational forces:

```
                                         Fγ        γ/k    γk2
                                  Π3 ≡        =         =     .
                                         Fg       ρg/k3   ρg
```

This choice has, by construction, a useful physical interpretation, but many other choices are possible. You can build a third group without using gravity: for example, Π3 ≡ γk3 /ρω2 . With this choice, ω appears in two groups: Π2 and Π3 . So it will be hard to solve for it. The choice made for P3 , besides being physically useful, quarantines ω in one group: a useful choice since ω is the goal. Now use the groups to solve for frequency ω as a function of wavenumber k. You can instead solve for k as a function of ω, but the formulas for phase and group velocity are simpler with ω as a function of k. Only the group Π2 contains ω, so the general dimensionless solution is

```
                                       Π2 = f (Π1 , Π3 ),

or

                                      ω2         γk2
                                         = f kh,     .
                                      gk         ρg

Then

                                                       γk2
                                    ω2 = gk · f (kh,       ).
                                                       ρg
```

This relation is valid for waves in shallow or deep water (small or large Π1 ); for waves propagated by gravity or by surface tension (small or large Π3 ); and for waves in between.

```
The ﬁgure shows how the two groups                                                       γk 2
                                                                                Π3 ≡
Π1 and Π3 divide the world of waves                                                      ρg

into four regions. We study each re­
                                                                                104
```

gion in turn, and combine the analyses to understand the whole world

```
(of waves). The group Π1 measures                         Shallow water
                                                          Surface tension           2                   Surface tension
the depth of the water: Are the waves                                           10
```

moving on a puddle or an ocean? The group Π3 measures the relative contribution of surface tension and grav­                                                                                          Π1 ≡ hk

```
ity: Are the waves ripples or gravity 10−4                       10−2                                     102
```

waves? The division into deep and shallow

```
water (left and right sides) follows            Shallow water 10−2
                                                   Gravity                  Gravity
```

from the interpretation of Π1 = kh as dimensionless depth. The division

```
into surface-tension- and gravity-dominated                   10−4
```

waves (top and bottom halves) is more subtle, but is a result of how Π3 was constructed. As a check, look at Π3 . Large g or small k result in the same consequence: small Π3 . Therefore the physical consequence of longer wavelength (smaller k) is similar to that of stronger gravity. So longer-wavelength waves are gravity waves. The large-Π3 portion of the world (top half) is therefore labeled with surface tension. The next ﬁgure shows how wavelength and depth (instead of the dimensionless groups) partition the world, and plots examples of different types of waves.

```
                                                     wavelength (m)

                                                                                     Tide

                                                      106
                                                                                        Π1 = 1

                                      Shallow water    4
                                      Gravity waves 10

                                                                        Storm wave at sea
                                                      102
                                        Storm wave at shore            Deep water
                                                                      Gravity waves

                                                                                            depth (m)
                                  10−4        10−2                    102       104

                                                                                        Π3 = 1
                     Ripple on thin puddle           10−2      Ripple on pond

                 Shallow-water                                         Deep water
                    Ripples                                             Ripples
                                                       −4
                                                     10
```

The thick dividing lines are based on the dimensionless groups Π1 = hk and Π3 = γk2 /ρg. Each region contains one or two examples of its kind of waves. With g = 1000 cm s−1

```
      10 Springs                                                                                                        105

      and ρ ∼ 1 g cm−3 , the border wavelength between ripples and gravity waves is just over
      λ ∼ 1 cm (the horizontal, Π3 = 1 dividing line).
      The magic function f is still unknown to us. To determine its form and to understand its
      consequences, study f in limiting cases. Like a jigsaw-puzzle-solver, study ﬁrst the corners
      of the world, where the physics is simplest. Then connect the corner solutions to get solu­
      tions valid along an edge, where the physics is the almost as simple as in a corner. Finally,
      crawl inward to assemble the complicated, complete solution. This extended example illus­
      trates divide-and-conquer reasoning, and using limiting cases to choose pieces into which
      you break the problem.

10.1.4 Deep water

      First study deep water, where kh  1, as shaded in the map.                                        γk 2
                                                                                                  Π3 ≡
                                                                                                         ρg
      Deep water is deﬁned as water sufﬁciently deep that waves
                                                                                                  104
      cannot feel the bottom of the ocean. How deep do waves’
      feelers extend? The only length scale in the waves is the wave­          Shallow water
                                                                               Surface tension
                                                                                                                  Deep water
                                                                                                                Surface tension
                                                                                                  102
      length, λ = 2π/k. The feelers therefore extend to a depth
      d ∼ 1/k (as always, neglect constants, such as 2π). This edu­                                                                     Π1 ≡ hk
                                                                        10−4          10−2                        102             104
      cated guess has a justiﬁcation in Laplace’s equation, which is
      the spatial part of the wave equation. Suppose that the waves
                                                                               Shallow water     10−2            Deep water
      are periodic in the x direction, and z measures depth below                 Gravity                         Gravity

      the surface, as shown in this ﬁgure:
                                                                                                 10−4

                                              y

                                 w

                                                                          x
                                               λ                 2λ

                                                            h

                            z

      Then, Laplace’s equation becomes

                                             ∂2 φ ∂2 φ
                                                 + 2 = 0,
                                             ∂x2  ∂z
      where φ is the velocity potential. The ∂2 φ/∂y2 term vanishes because nothing varies along
      the width (the y direction).
      It’s not important what exactly φ is. You can ﬁnd out more about it in an excellent ﬂuid-
      mechanics textbook, Fluid Dynamics for Physicists [18]; Lamb’s Hydrodynamics [19] is a classic
```

but difﬁcult. For this argument, all that matters is that φ measures the effect of the wave and that φ satisﬁes Laplace’s equation. The wave is periodic in the x direction, with a form such as sin kx. Take

```
                                         φ ∼ Z(z) sin kx.
```

The function Z(z) measures how the wave decays with depth. The second derivative in x brings out two factors of k, and a minus sign:

```
                                          ∂2 φ
                                               = −k2 φ.
                                          ∂x 2
```

In order that this φ satisfy Laplace’s equation, the z-derivative term must contribute +k2 φ. Therefore,

```
                                           ∂2 φ
                                                = k2 φ,
                                           ∂z2
```

so Z(z) ∼ e±kz . The physically possible solution – the one that does not blow up exponentially at the bottom of the ocean – is Z(z) ∼ e−kz . Therefore, relative to the effect of the wave at the surface, the effect of the wave at the bottom of the ocean is ∼ e−kh . When kh  1, the bottom might as well be on the moon because it has no effect. The dimensionless factor kh – it must be dimensionless to sit alone in an exponent – compares water depth with feeler depth d ∼ 1/k:

```
                                   water depth   h
                                               ∼    = hk,
                                   feeler depth 1/k
```

which is the dimensionless group Π1 . In deep water, where the bottom is hidden from the waves, the water depth h does not affect their propagation, so h disappears from the list of relevant variables. When h goes, so does Π1 = kh. There is one caveat. If Π1 is the only group that contains k, then you cannot blithely discard Π1 just because you no longer care about h. If you did, you would be discarding k and h, and make it impossible to ﬁnd a dispersion relation (which connects ω and k). Fortunately, k appears in Π3 = γk2 /ρg as well as in Π1 . So in deep water it is safe to discard Π1 . This argument for the irrelevance of h is a physical argument. It has a mathematical equivalent in the language of dimensionless groups and functions. Because h has dimensions, the statement that ‘h is large’ is meaningless. The question is, ‘large compared to what length?’ With 1/k as the standard of comparison the meaningless ‘h is large’ statement becomes ‘kh is large.’ The product kh is the dimensionless group Π1 . Mathematically, you are assuming that the function f (kh, γk2 /ρg) has a limit as kh → ∞. Without Π1 , the general dispersion relation simpliﬁes to

```
                                                      γk2
                                      ω2 = gk fdeep       .
                                                      ρg
```

This relation describes the deep-water edge of the world of waves. The edge has two corners, labeled by whether gravity or surface tension provides the restoring force. Although

```
         10 Springs                                                                                                                  107

         the form of fdeep is unknown, it is a simpler function than the original f , a function of two
         variables. To determine the form of fdeep , continue the process of dividing and conquering:
         Partition deep-water waves into its two limiting cases, gravity waves and ripples.

10.1.5 Gravity waves on deep water

         Of the two extremes, gravity waves are the more common.                                                      γk 2
                                                                                                               Π3 ≡
                                                                                                                      ρg
         They include wakes generated by ships and most waves gen-
                                                                                                               104
         erated by wind. So specialize to the corner of the wave world
         where water is deep and gravity is strong. With gravity much                       Shallow water
                                                                                            Surface tension
                                                                                                                               Deep water
                                                                                                                             Surface tension
                                                                                                               102
         stronger than surface tension, the dimensionless group Π3 =
         γk2 /ρg limits to 0. Since Π3 is the product of several factors,                                                                            Π1 ≡ hk
                                                                                     10−4          10−2                        102             104
         you can achieve the limit in several ways:

                                                                                                              10−2
         1. Increase g (which is downstairs) by moving to Jupiter.                          Shallow water
                                                                                               Gravity
                                                                                                                              Deep water
                                                                                                                               Gravity

         2. Reduce γ (which is upstairs) by dumping soap on the wa­
                                                                                                              10−4
            ter.
         3. Reduce k (which is upstairs) by studying waves with a huge wavelength.

         In this limit, the general deep-water dispersion relation simpliﬁes to

                                                 ω2 = fdeep (0)gk = C1 gk,

         where fdeep (0) is an as-yet-unknown constant, C1 . The use of fdeep (0) assumes that fdeep (x)
         has a limit as x → 0. The slab argument, which follows shortly, shows that it does. For now,
         in order to make progress, assume that it has a limit. The constant remains unknown to the
         lazy methods of dimensional analysis, because the methods sacriﬁce evaluation of dimen­
         sionless constants to gain comprehension of physics. Usually assume that such constants
         are unity. In this case, we get lucky: An honest calculation produces C1 = 1 and

                                                        ω2 = 1×gk,

         where the red 1× indicates that it is obtained from honest physics.
         Such results from dimensional analysis seem like rabbits jumping from a hat. The disper­
         sion relation is correct, but your gut may grumble about this magical derivation and ask,
         ‘But why is the result true?’ A physical model of the forces or energies that drive the waves
         explains the origin of the dispersion relation. The ﬁrst step is to understand the mechanism:
         How does gravity make the water level rise and fall? Taking a hint from the Watergate in­
         vestigators, 1 we follow the water. The water in the crest does not move into the trough.
         Rather, the water in the crest, being higher, creates a pressure underneath it higher than
         that of the water in the trough, as shown in this ﬁgure:

     1
         When the reporters Woodward and Bernstein [20] were investigating criminal coverups during the Nixon ad­
         ministration, they received help from the mysterious ‘Deep Throat’, whose valuable advice was to ‘follow the
         money.’

                                            p0
                                                 =
                                                     1a
                                                       tm

                              z+ξ

                                                                          z−ξ
                                                      Flow
                                                     ===⇒
                      p> ∼ p0 + ρg(z + ξ)                       p< ∼ p0 + ρg(z − ξ)
```

The higher pressure forces water underneath the crest to ﬂow toward the trough, making the water level there rise. Like a swing sliding past equilibrium, the surface overshoots the equilibrium level to produce a new crest and the cycle repeats. The next step is to quantify the model by estimating sizes, forces, speeds, and energies. In Section 9.1 we analyzed a messy mortality curve by replacing it with a more tractable shape: a rectangle. The method of discretization worked there, so try it again. ‘A method is a trick I use twice.’ —George Polyà. Water just underneath the surface moves quickly because of the pressure gradient. Farther down, it moves more slowly. Deep down it does not move at all. Replace this smooth falloff with a step function: Pretend that water down to a certain depth moves as a block, while deeper water stays still:

```
                                                             Atop ∼ w/k
                                    w

           Higher                                                                      Lower
          pressure                                                                    pressure

                        1/k

                                            1/k
```

How deep should this slab of water extend? By the Laplace-equation argument, the pressure variation falls off exponentially with depth, with length scale 1/k. So assume that the slab has a similar length scale, that it has depth 1/k. What choice do you have? On an inﬁnitely deep ocean, the only length scale is 1/k. How long should the slab be? Its length should be roughly the peak-to-trough distance of the wave because the surface height changes signiﬁcantly over that distance. This distance is 1/k. Actually, it is π/k (one-half of a period), but ignore constants. All the constants combine into a giant constant at the end, which dimensional analysis cannot determine anyway, so discard it now! The slab’s width w is arbitrary and cancels by the end of any analysis.

So the slab of water has depth 1/k, length 1/k, and width w. Estimate the forces acting on it by estimating the pressure gradients. Across the width of the slab (the y direction), the water surface is level, so the pressure is constant along the width. Into the depths (the z direction), the pressure varies because of gravity – the ρgh term from hydrostatics – but that variation is just sufﬁcient to prevent the slab from sinking. We care about only the pressure difference across the length, the direction that the wave moves. This pressure difference depends on the height of the crest, ξ and is Δp ∼ ρgξ. This pressure difference acts on a cross-section with area A ∼ w/k to produce a force

```
                                F ∼ w/k × ρgξ = ρgwξ/k.
                                    
                                      area           Δp

The slab has mass

                                           m = ρ × w/k2 ,
                                                  
                                                      volume

so the force produces an acceleration
                                           ρgwξ  ρw
                                 aslab ∼             = gξk.
                                             k   k2
                                            
                                             force        mass
```

The factor of g says that the gravity produces the acceleration. Full gravitational acceleration is reduced by the dimensionless factor ξk, which is roughly the slope of the waves. The acceleration of the slab determines the acceleration of the surface. If the slab moves a distance x, it sweeps out a volume of water V ∼ xA. This water moves under the trough, and forces the surface upward a distance V/Atop . Because Atop ∼ A (both are ∼ w/k), the surface moves the same distance x that the slab moves. Therefore, the slab’s acceleration aslab equals the acceleration a of the surface:

```
                                           a ∼ aslab ∼ gξk.
```

This equivalence of slab and surface acceleration does not hold in shallow water, where the bottom at depth h cuts off the slab before 1/k; that story is told in Section 10.1.12. The slab argument is supposed to justify the deep-water dispersion relation derived by dimensional analysis. That relation contains frequency whereas acceleration relation does not. So massage it until ω appears. The acceleration relation contains a and ξ, whereas the dispersion relation does not. An alternative expression for the acceleration might make the acceleration relation more like the dispersion relation. With luck the expression will contain ω2 , thereby producing the hoped-for ω2 ; as a bonus, it will contain ξ to cancel the ξ in the acceleration relation. In simple harmonic motion (springs!), acceleration is a ∼ ω2 ξ, where ξ is the amplitude. In waves, which behave like springs, a is given by the same expression. Here’s why. In

time τ ∼ 1/ω, the surface moves a distance d ∼ ξ, so a/ω2 ∼ ξ and a ∼ ω2 ξ. With this replacement, the acceleration relation becomes

```
                                           ω2 ξ ∼ gξk,
                                          
                                               a

or

                                              ω2 = 1×gk,
```

which is the longed-for dispersion relation with the correct dimensionless constant in red. An exact calculation conﬁrms the usual hope that the missing dimensionless constants are close to unity, or are unity. This fortune suggests that the procedures for choosing how to measure the lengths were reasonable. The derivation depended on two choices:

1. Replacing an exponentially falling variation in velocity potential by a step function with
size equal to the length scale of the exponential decay.

2. Taking the length of the slab to be 1/k instead of π/k. This choice uses only 1 radian of
the cycle as the characteristic length, instead of using a half cycle or π radians. Since 1 is a more natural dimensionless number than π is, choosing 1 radian rather than π or 2π radians often improves approximations.

Both approximations are usually accurate in order-of-magnitude calculations. Rarely, however, you will get caught by a factor of (2π)6 , and wish that you had used a full cycle instead of only 1 radian.

```
                                    w

                                ξ

                                        1/k
```

The derivation that resulted in the dispersion relation analyzed the motion of the slab using forces. Another derivation of it uses energy by balancing kinetic and potential energy. To make a wavy surface requires energy, as shown in the ﬁgure. The crest rises a characteristic height ξ above the zero of potential, which is the level surface. The volume of water moved upward is ξw/k. So the potential energy is

```
                              PEgravity ∼ ρξw/k ×gξ ∼ ρgwξ2 /k.
                                          
                                               m
```

The kinetic energy is contained in the sideways motion of the slab and in the upward motion of the water pushed by the slab. The slab and surface move at the same speed; they also have the same acceleration. So the sideways and upward motions contribute similar energies. If you ignore constants such as 2, you do not need to compute the energy contributed by both motions and can do the simpler computation, which is the sideways motion. The

surface moves a distance ξ in a time 1/ω, so its velocity is ωξ. The slab has the same speed (except for constants) as the surface, so the slab’s kinetic energy is

```
                           KEdeep ∼ ρw/k2 × ω2 ξ2 ∼ ρω2 ξ2 w/k2 .
                                     
                                       mslab           v2
```

This energy balances the potential energy

```
                                   ρω2 ξ2 w/k2 ∼ ρgwξ2 /k .
                                        
                                        KE                    PE
```

Canceling the factor ρwξ2 (in red) common to both energies leaves

```
                                               ω2 ∼ gk.
```

The energy method agrees with the force method, as it should, because energy can be derived from force by integration. The energy derivation gives an interpretation of the dimensionless group Π2 :

```
                                    kinetic energy in slab       ω2
                         Π2 ∼                                  ∼    .
                                gravitational potential energy   gk
```

The gravity-wave dispersion relation ω2 = gk is equivalent to Π2 ∼ 1, or to the assertion that kinetic and gravitational potential energy are comparable in wave motion. This rough equality is no surprise because waves are like springs. In spring motion, kinetic and potential energies have equal averages, a consequence of the virial theorem. The dispersion relation was derived in three ways: by dimensional analysis, energy, and force. Using multiple methods increases our conﬁdence not only in the result but also in the methods. ‘I have said it thrice: What I tell you three times is true.’ –Lewis Carroll, Hunting of the Snark. We gain conﬁdence in the methods of dimensional analysis and in the slab model for waves. If we study nonlinear waves, for example, where the wave height is no longer inﬁnitesimal, we can use the same techniques along with the slab model with more conﬁdence. With reasonable conﬁdence in the dispersion relation, it’s time study its consequences: the phase and group velocities. The crests move at the phase velocity: vph = w/k. For deepwater gravity waves, this velocity becomes

```
                                              
                                                g
                                        vph =     ,
                                                k
```

or, using the dispersion relation to replace k by ω,

```
                                                        g
                                               vph =      .
                                                        ω
```

Let’s check upstairs and downstairs. Who knows where ω belongs, but g drives the waves so it should and does live upstairs.

```
      In an inﬁnite, single-frequency wave train, the crests and troughs move at the phase speed.
      However, a ﬁnite wave train contains a mixture of frequencies, and the various frequencies
      move at different speeds as given by
                                                        g
                                                vph =     .
                                                        ω
      Deep water is dispersive. Dispersion makes a ﬁnite wave train travel with the group ve­
      locity, given by vg = ∂w/∂k, as explained in Section 10.1.2. The group velocity is
                                                      
                                            ∂       1 g 1
                                      vg =     gk =        = vph .
                                           ∂k        2 k 2
      So the group velocity is one-half of the phase velocity, as the result for power-law dispersion
      relation predicts. Within a wave train, the crests move at the phase velocity, twice the group
      velocity, shrinking and growing to ﬁt under the slower-moving envelope.
      An everyday consequence is that ship wakes trail the ship. A ship moving with velocity
      v creates gravity waves with vph = v. The waves combine to produce wave trains that
      propagate forward with the group velocity, which is only vph /2 = v/2. From the ship’s
      point of view, these gravity waves travel backward. In fact, they form a wedge, and the
      opening angle of the wedge depends on the one-half that arises from the exponent.

10.1.6 Surﬁng

      Let’s apply the dispersion relation to surﬁng. Following one winter storm reported in the
      Los Angeles Times – the kind of storm that brings cries of ‘Surf’s up!’ – waves arrived at
      Los Angeles beaches roughly every 18 s. How fast were the storm winds that generated
      the waves? Wind pushes the crests as long as they move more slowly than the wind. After
      a long-enough push, the crests move with nearly the wind speed. Therefore the phase
      velocity of the waves is an accurate approximation to the wind speed.
      The phase velocity is g/ω. In terms of the wave period T, this velocity is vph = gT/2π, so
                                                  g           T
                                                
                                             10 m s−2 × 18 s
                               vwind ∼ vph ∼                 ∼ 30 m s−1 .
                                                   2×3
      In units more familiar to Americans, this wind speed is 60 mph, which is a strong storm:
      about 10 on the Beaufort wind scale (‘whole gale/storm’). The wavelength is given by

                                   λ = vph T ∼ 30 m s−1 × 18 s ∼ 500 m.

      On the open ocean, the crests are separated by half a kilometer. Near shore they bunch up
      because they feel the bottom; this bunching is a consequence of the shallow-water disper­
      sion relation, the topic of Section 10.1.13.
      In this same storm, the waves arrived at 17 s intervals the following day: a small decrease
      in the period. Before racing for the equations, ﬁrst check that this decrease in period is
      reasonable. This precaution is a sanity check. If the theory is wrong about a physical effect

      10 Springs                                                                              113

      as fundamental as a sign – whether the period should decrease or increase – then it neglects
      important physics. The storm winds generate waves of different wavelengths and periods,
      and the different wavelengths sort themselves during the trip from the far ocean to Los
      Angeles. Group and phase velocity are proportional to 1/ω, which is proportional to the
      period. So longer-period waves move faster, and the 18 s waves should arrive before the
      17 s waves. They did! The decline in the interval allows us to calculate the distance to the
      storm. In their long journey, the 18 s waves raced 1 day ahead of the 17 s waves. The ratio
      of their group velocities is
                                  velocity(18 s waves) 18     1
                                                      =   =1+ .
                                  velocity(17 s waves) 17    17

      so the race must have lasted roughly t ∼ 17 days ∼ 1.5 · 106 s. The wave train moves at the
      group velocity, vg = vph /2 ∼ 15 m s−1 , so the storm distance was d ∼ tvg ∼ 2 · 104 km, or
      roughly halfway around the world, an amazingly long and dissipation-free journey.

                                                               USA
                                                         LA

                                                         t ∼ 17 days

                                                storm

10.1.7 Speedboating

      Our next application of the dispersion relation is to speedboating: How fast can a boat
      travel? We exclude hydroplaning boats from our analysis (even though some speedboats
      can hydroplane). Longer boats generally move faster than shorter boats, so it is likely that
      the length of the boat, l, determines the top speed. The density of water might matter.
      However, v (the speed), ρ, and l cannot form a dimensionless group. So look for another
      variable. Viscosity is irrelevant because the Reynolds number for boat travel is gigantic.
      Even for a small boat of length 5 m, creeping along at 2 m s−1 ,

                                          500 cm × 200 cm s−1
                                   Re ∼                       ∼ 107 .
                                              10−2 cm2 s−1
      At such a huge Reynolds number, the ﬂow is turbulent and nearly independent of viscosity
      (Section 8.3.7). Surface tension is also irrelevant, because boats are much longer than a
      ripple wavelength (roughly 1 cm). The search for new variables is not meeting with success.
      Perhaps gravity is relevant. The four variables v, ρ, g, and l, build from three dimensions,
      produce one dimensionless group: v2 /gl, also called the Froude number:

                                                        v2
                                                Fr ≡       .
                                                        gl
```

The critical Froude number, which determines the maximum boat speed, is a dimensionless constant. As usual, we assume that the constant is unity. Then the maximum boating speed is:

```
                                                        
                                                   v∼       gl.
```

A rabbit has jumped out of our hat. What physical mechanism justiﬁes this dimensionalanalysis result? Follow the waves as a boat plows through water. The moving boat generates waves (the wake), and it rides on one of those waves. Take the bow wave: It is a gravity wave with vph ∼ vboat . Because v2ph = ω2 /k2 , the dispersion relation tells us that

```
                                                     ω2   g
                                          v2boat ∼     2
                                                         = = gλ,
                                                              ¯
                                                     k    k
```

whereλ̄ ≡ 1/k = λ/2π. So the wavelength of the waves is roughly v2boat /g. The other length in this problem is the boat length; so the Froude number has this interpretation:

```
                                  v2boat /g       wavelength of bow wave
                           Fr =               ∼                          .
                                      l               length of boat
```

Why is Fr ∼ 1 the critical number, the assumption in ﬁnding the maximum boat speed? Interesting and often difﬁcult physics occurs when a dimensionless number is near unity. In this case, the physics is as follows. The wave height changes signiﬁcantly in a distanceλ̄; if the boat’s length l is comparable toλ̄, then the boat rides on its own wave and tilts upward. Tilting upward, it presents a large cross-section to the water, and the drag becomes huge. [Catamarans and hydrofoils skim the water, so this kind of drag does not limit their speed. The hydrofoil makes a much quicker trip across the English channel than the ferry makes, even though the hydrofoil is much shorter.] So the top speed is given by

```
                                                            
                                                  vboat ∼       gl.
```

For a small motorboat, with length l ∼ 5 m, this speed is roughly 7 m s−1 , or 15 mph. Boats (for example police boats) do go faster than the nominal top speed, but it takes plenty of power to ﬁght the drag, which is why police boats have huge engines. The Froude number in surprising places. It determines, for example, the speed at which an animal’s gait changes from a walk to a trot or, for animals that do not trot, to a run. In Section 10.1.7 it determines maximum boating speed. The Froude number is a ratio of potential energy to kinetic energy, as massaging the Froude number shows:

```
                                      v2 mv2    kinetic energy
                              Fr =       =    ∼                 .
                                      gl   mgl potential energy
```

Here the massage technique was multiplication by unity (in red). In this example, the length l is a horizontal length, so gl is not a gravitational energy, but it has a similar structure and in other examples often has an easy interpretation as gravitational energy.

```
      10 Springs                                                                                                  115

10.1.8 Walking

      In the Froude number for walking speed, l is leg length, and gl is a potential energy. For
      a human with leg length l ∼ 1 m, the condition Fr ∼ 1 implies that v ∼ 3 m s−1 or 6 mph.
      This speed is a rough estimate for the top speed for a race walker. The world record for
      men’s race walking was once held by Bernado Segura of Mexico. He walked 20 km in
      1h:17m:25.6s, for a speed of 4.31 m s−1 .
      This example concludes the study of gravity waves on deep water, which is one corner of
      the world of waves.

10.1.9 Ripples on deep water

      For small wavelengths (large k), surface tension rather than                                γk    2
                                                                                              Π ≡   3
                                                                                                  ρg
      gravity provides the restoring force. This choice brings us to                                4
                                                                                             10
      the shaded corner of the ﬁgure. If surface tension rather than
      gravity provides the restoring force, then g vanishes from the        Shallow water
                                                                            Surface tension         2
                                                                                                       Deep water
                                                                                                     Surface tension
                                                                                             10
      ﬁnal dispersion relation. How to get rid of g and ﬁnd the
      new dispersion relation? You could follow the same pattern                                                            Π1 ≡ hk
                                                                                     −4      −2               2         4
      as for gravity waves (Section 10.1.5). In that situation, the 10             10                  10            10

      surface tension γ was irrelevant, so we discarded the group                                  −2
                                                                            Shallow water   10         Deep water
      Π3 ≡ γk2 /ρg. Here, with g irrelevant you might try the same             Gravity                  Gravity

      trick: Π3 contains g so discard it. In that argument lies in­                                −4
                                                                                            10
      fanticide, because it also throws out the physical effect that
      determines the restoring force, namely surface tension. To re­
      trieve the baby from the bathwater, you cannot throw out γk2 /ρg directly. Instead you have
      to choose the form of the dimensionless function fdeep in so that only gravity vanishes from
      the dispersion relation.
      The deep-water dispersion relation contains one power of g in front. The argument of fdeep
      also contains one power of g, in the denominator. If fdeep has the form fdeep (x) ∼ x, then g
      cancels. With this choice, the dispersion relation is

                                                               γk3
                                                     ω2 = 1×       .
                                                                ρ

      Again the dimensionless constant from exact calculation (in red) is unity, which we would
      have assumed anyway. Let’s reuse the slab argument to derive this relation.
      In the slab picture, replace gravitational by surface-tension energy, and again balance po­
      tential and kinetic energies. The surface of the water is like a rubber sheet. A wave disturbs
      the surface and stretches the sheet. This stretching creates area ΔA and therefore requires
      energy γΔA. So to estimate the energy, estimate the extra area that a wave of amplitude ξ
      and wavenumber k creates. The extra area depends on the extra length in a sine wave com­
      pared to a ﬂat line. The typical slope in the sine wave ξ sin kx is ξk. Instead of integrating
      to ﬁnd the arc length, you can approximate the curve as a straight line with slope ξk:

                                                                2)
                                                                )
                                                       +   (ξ k
                                                 l 0(1
                                            l∼
                                                                            ξ

                                            θ ∼ slope ∼ ξk
                                                  l0 ∼ 1/k
```

Relative to the level line, the tilted line is longer by a factor 1 + (ξk)2 . As before, imagine a piece of a wave, with characteristic length 1/k in the x direction and width w in the y direction. The extra area is

```
                              ΔA ∼ w/k ×                   (ξk)2          ∼ wξ2 k.
                                                       
                                    level area    fractional increase
```

The potential energy stored in this extra surface is

```
                                     PEripple ∼ γΔA ∼ γwξ2 k.
```

The kinetic energy in the slab is the same as it is for gravity waves, which is:

```
                                         KE ∼ ρω2 ξ2 w/k2 .

Balancing the energies

                                       ρω2 ξ2 w/k2 ∼ γwξ2 k,
                                          
                                             KE                      PE

gives

                                             ω2 ∼ γk3 /ρ.
```

This dispersion relation agrees with the result from dimensional analysis. For deep-water gravity waves, we used both energy and force arguments to re-derive the dispersion relation. For ripples, we worked out the energy argument, and you are invited to work out the corresponding force argument. The energy calculation completes the interpretations of the three dimensionless groups. Two are already done: Π1 is the dimensionless depth and Π2 is ratio of kinetic energy to gravitational potential energy. We constructed Π3 as a group that compares the effects of surface tension and gravity. Using the potential energy for gravity waves and for ripples, the comparison becomes more precise:

```
                                      potential energy in a ripple
                            Π3 ∼
                                  potential energy in a gravity wave
                                   γwξ2 k
                                ∼
                                  ρgwξ2 /k
                                  γk2
                                ∼     .
                                  ρg
```

Alternatively, Π3 compares γk2 /ρ with g:

```
                                                   γk2 /ρ
                                          Π3 ≡            .
                                                     g
```

This form of Π3 may seem like a trivial revision of γk2 /ρg. However, it suggests an interpretation of surface tension: that surface tension acts like an effective gravitational ﬁeld with strength

```
                                     gsurface tension = γk2 /ρ,
```

In a balloon, the surface tension of the rubber implies a higher pressure inside than outside. Similarly in wave the water skin implies a higher pressure underneath the crest, which is curved like a balloon; and a lower pressure under the trough, which is curved opposite to a balloon. This pressure difference is just what a gravitational ﬁeld with strength gsurface tension would produce. This trick of effective gravity, which we used for the buoyant force on a falling marble (Section 8.3.4), is now promoted to a method (a trick used twice). So replace g in the gravity-wave potential energy with this effective g to get the ripple potential energy:

```
                                                  g→γk2 /ρ
                               ρgwξ2 /k          ======⇒         γwξ2 k .
                                                             
                            PE(gravity wave)                    PE(ripple)
```

The left side becomes the right side after making the substitution above the arrow. The same replacement in the gravity-wave dispersion relation produces the ripple dispersion relation:

```
                                               g→γk2 /ρ              γk3
                               ω2 = gk     ======⇒            ω2 =       .
                                                                      ρ
```

The interpretation of surface tension as effective gravity is useful when we combine our solutions for gravity waves and for ripples, in Section 10.1.11 and Section 10.1.16. Surface tension and gravity are symmetric: We could have reversed the analysis and interpreted gravity as effective surface tension. However, gravity is the more familiar force, so we use effective gravity rather than effective surface tension. With the dispersion relation you can harvest the phase and group velocities. The phase velocity is

```
                                              
                                         ω       γk
                                    vph ≡ =         ,
                                          k      ρ

and the group velocity is
                                                ∂ω 3
                                         vg ≡      = vph .
                                                ∂k  2
```

The factor of 3/2 is a consequence of the form of the dispersion relation: ω ∝ k3/2 ; for gravity waves, ω ∝ k1/2 , and the corresponding factor is 1/2. In contrast to deep-water waves, a

```
        train of ripples moves faster than the phase velocity. So, ripples steam ahead of a boat,
        whereas gravity waves trail behind.

10.1.10 Typical ripples

        Let’s work out speeds for typical ripples, such as the ripples from dropping a pebble into a
        pond. From observation, these ripples have wavelength λ ∼ 1 cm, and therefore wavenum­
        ber k = 2π/λ ∼ 6 cm−1 . The surface tension of water (??) is γ ∼ 0.07 J m−2 . So the phase
        velocity is
                                          ⎛          γ
                                                                     ⎞1/2
                                          ⎜⎜               ⎟⎟⎟⎟
                                                                 k
                                           ⎜⎜
                                            ⎜⎜                         ⎟
                                             ⎜⎜ 0.07 J m−2 × 600 m−1 ⎟⎟⎟
                                  vph = ⎜⎜⎜   ⎜                        ⎟⎟ ∼ 21 cm s−1 .
                                                              −3        ⎟⎟
                                              ⎜⎜        3
                                                     10 kg m             ⎟⎟
                                               ⎜⎜                         ⎟
                                                ⎜⎝               ⎟⎟⎠
                                                          ρ

        According to relation between phase and group velocities, the group velocity is 50 percent
        larger than the phase velocity: vg ∼ 30 cm s−1 . This wavelength of 1 cm is roughly the
        longest wavelength that still qualiﬁes as a ripple, as shown in an earlier ﬁgure repeated
        here:
                                                               wavelength (m)

                                                                                               Tide

                                                                   106
                                                                                                   Π1 = 1

                                               Shallow water    4
                                               Gravity waves 10

                                                                                     Storm wave at sea
                                                                   102
                                                 Storm wave at shore             Deep water
                                                                                Gravity waves

                                                                                                      depth (m)
                                           10−4        10−2                     102          104

                                                                                                   Π3 = 1
                              Ripple on thin puddle            10−2      Ripple on pond

                          Shallow-water                                          Deep water
                             Ripples                                              Ripples
                                                                   −4
                                                               10

        The third dimensionless group, which distinguishes ripples from gravity waves, has value
                                                           γ                    k2
                                                           
                                           γk2        0.07 J m−2 × 3.6 · 105 m−2
                                  Π3 ≡         ∼                       ∼ 2.6.
                                           ρg    103 kg m−3 × 10 m s−2
                                                      
                                                               ρ                 g

        With a slightly smaller k, the value of Π3 would slide into the gray zone Π3 ≈ 1. If k were yet
        smaller, the waves would be gravity waves. Other ripples, with a larger k, have a shorter

       10 Springs                                                                                                                119

       wavelength, and therefore move faster: 21 cm s−1 is roughly the minimum phase velocity
       for ripples. This minimum speed explains why we see mostly λ ∼ 1 cm ripples when we
       drop a pebble in a pond. The pebble excites ripples of various wavelengths; the shorter
       ones propagate faster and the 1 cm ones straggle, so we see the stragglers clearly, without
       admixture of other ripples.
```

10.1.11 Combining ripples and gravity waves on deep water

```
       With two corners assembled – gravity waves and ripples in                                                  γk 2
                                                                                                           Π3 ≡
                                                                                                                  ρg
       deep water – you can connect the corners to form the deep-
                                                                                                           104
       water edge. The dispersion relations, for convenience restated
       here, are                                                                        Shallow water
                                                                                        Surface tension
                                                                                                                           Deep water
                                                                                                                         Surface tension
                                                                                                           102

                       2     gk,      gravity waves;
                     ω =
                             γk3 /ρ, ripples.                                                                                                    Π1 ≡ hk
                                                                                 10−4          10−2                        102             104

       With a little courage, you can combine the relations in these
                                                                                                          10−2
       two extreme regimes to produce a dispersion relation valid                       Shallow water
                                                                                           Gravity
                                                                                                                          Deep water
                                                                                                                           Gravity

       for gravity waves, for ripples, and for waves in between.
                                                                                                          10−4
       Both functional forms came from the same physical argument
       of balancing kinetic and potential energies. The difference was the source of the potential
       energy: gravity or surface tension. On the top half of the world of waves, surface tension
       dominates gravity; on the bottom half, gravity dominates surface tension. Perhaps in the
       intermediate region, the two contributions to the potential energy simply add. If so, the
       combination dispersion relation is the sum of the two extremes:

                                             ω2 = gk + γk3 /ρ.

       This result is exact (which is why we used an equality). When in doubt, try the simplest
       solution.
       You can increase your conﬁdence in this result by using the effective gravity produced by
       surface tension. The two sources of gravity – real and effective – simply add, to make

                                                                         γk2
                                   gtotal = g + gsurface tension = g +       .
                                                                          ρ

       Replace g by gtotal in ω2 = gk reproduces the deep-water dispersion relation:

                                                 γk2
                                     ω2 = g +        k = gk + γk3 /ρ.
                                                  ρ

       This dispersion relation tells us wave speeds for all wavelengths or wavenumbers. The
       phase velocity is
                                                    
                                                ω     γk g
                                          vph ≡ =         + .
                                                k      ρ     k
```

Let’s check upstairs and downstairs. Surface tension and gravity drive the waves, so γ and g should be upstairs. Inertia slows the waves, so ρ should be downstairs. The phase velocity passes these tests. As a function of wavenumber, the two terms in the square root compete to increase the speed. The surface-tension term wins at high wavenumber; the gravity term wins at low wavenumber. So there is an intermediate, minimum-speed wavenumber, k0 , which we can estimate by balancing the surface tension and gravity contributions:

```
                                         γk0  g
                                             ∼ .
                                          ρ   k0
```

This computation is an example of order-of-magnitude minimization. The minimum-speed wavenumber is

```
                                            
                                              ρg
                                       k0 ∼      .
                                              γ
```

Interestingly, 1/k0 is the maximum size of raindrops. At this wavenumber Π3 = 1: These waves lie just on the border between ripples and gravity waves. Their phase speed is

```
                                                   1/4
                                         2g     4γg
                                  v0 ∼       ∼          .
                                         k0      ρ
```

In water, the critical wavenumber is k0 ∼ 4 cm−1 , so the critical wavelength is λ0 ∼ 1.5 cm; the speed is

```
                                       v0 ∼ 23 cm s−1 .
```

We derived the speed dishonestly. Instead of using the maximum–minimum methods of calculus, we balanced the two contributions. A calculus derivation conﬁrms the minimum phase velocity. A tedious calculus calculation shows that the minimum group velocity is

```
                                      vg ≈ 17.7 cm s−1 .
```

[If you try to reproduce this calculation, be careful because the minimum group velocity is not the group velocity at k0 .] Let’s do the minimizations honestly. The calculation is not too messy if it’s done with good formula hygiene plus a useful diagram, and the proper method is useful in many physical maximum–minimum problems. We illustrate the methods by ﬁnding the minimum of the phase velocity. That equation contains constants – ρ, γ, and g – which carry through all the differentiations. To simplify the manipulations, choose a convenient set of units in which

```
                                       ρ = γ = g = 1.
```

The analysis of waves uses three basic dimensions: mass, length, and time. Choosing three constants equal to unity uses up all the freedom. It is equivalent to choosing a canonical mass, length, and time, and thereby making all quantities dimensionless. Don’t worry: The constants will return at the end of the minimization.

In addition to constants, the phase velocity also contains a square root. As a ﬁrst step in formula hygiene, minimize instead v2ph . In the convenient unit system, it is

```
                                                      1
                                            v2ph = k + .
                                                      k
```

This minimization does not need calculus, even to do it exactly. The two terms are both positive, so you can use the arithmetic-mean–geometric-mean inequality (affectionately known as AM–GM) for k and 1/k. The inequality states that, for positive a and b,

```
                                                   √
                                       (a + b)/2 ≥   ab ,
                                          
                                         AM          GM
```

with equality when a = b. The ﬁgure shows a geometric proof of this inequality. You are invited to convince yourself that the ﬁgure is a proof. With a = k and b = 1/k the geometric mean is unity, so the arithmetic mean is ≥ 1. Therefore

```
                                   1
                              k+     ≥ 2,
                                   k
```

with equality when k = 1/k, namely when k = 1. At this wavenum­

```
                         √
```

ber the phase velocity is 2. Still in this unit system, the dispersion relation is

```
                                   √
                            ω=      k3 + k,

and the group velocity is
                                               ∂√ 3
                                        vg =      k + k,
                                               ∂k
which is

                                               1 3k2 + 1
                                        vg =     √       .
                                               2 k3 + k
                                   √
```

At k = 1 the group velocity is also 2: These borderline waves have equal phase and group velocity. This equality is reasonable. In the gravity-wave regime, the phase velocity is greater than the group velocity. In the ripple regime, the phase velocity is less than the group velocity. So they must be equal somewhere in the intermediate regime. To convert k = 1 back to normal units, multiply it by unity in the form of a convenient product of ρ, γ, and g (which are each equal to 1 for the moment). How do you make a

```
                                                         
```

length from ρ, γ, and g? The form of the result says that ρg/γ has units of L−1 . So k = 1

```
                       
```

really means k = 1 × ρg/γ, which is the same as the order-of-magnitude minimization. This exact calculation shows that the missing dimensionless constant is 1. The minimum group velocity is more complicated than the minimum phase velocity because it requires yet another derivative. Again, remove the square root and minimize v2g . The derivative is

```
                                 ∂ 9k4 + 6k2 + 1 (3k2 + 1)(3k4 + 6k2 − 1)
                                                 =                        .
                                 ∂k    k3 + k            (k3 + k)2
                                            
                                          v2g

       Equating this derivative to zero gives 3k4 + 6k2 − 1 = 0, which is a quadratic in k2 , and has
       positive solution
                                             !      
                                        k1 = −1 + 4/3 ∼ 0.393.

       At this k, the group velocity is

                                                  vg (k1 ) ≈ 1.086.

       In more usual units, this minimum velocity is
                                                                  1/4
                                                             γg
                                                vg ≈ 1.086              .
                                                             ρ

       With the density and surface tension of water, the minimum group velocity is 17.7 cm s−1 ,
       as claimed previously.
       After dropping a pebble in a pond, you see a still circle surrounding the drop point. Then
       the circle expands at the minimum group velocity given. Without a handy pond, try the
       experiment in your kitchen sink: Fill it with water and drop in a coin or a marble. The
       existence of a minimum phase velocity, is useful for bugs that walk on water. If they move
       slower than 23 cm s−1 , they generate no waves, which reduces the energy cost of walking.

10.1.12 Shallow water

       In shallow water, the height h, absent in the deep-water calcu-                                       γk 2
                                                                                                      Π3 ≡
                                                                                                             ρg
       lations, returns to complicate the set of relevant variables. We
                                                                                                      104
       are now in the shaded region of the ﬁgure. This extra length
       scale gives too much freedom. Dimensional analysis alone                    Shallow water
                                                                                   Surface tension
                                                                                                                      Deep water
                                                                                                                    Surface tension
                                                                                                      102
       cannot deduce the shallow-water form of the magic function
        f in the dispersion relation. The slab argument can do the job,                                                                     Π1 ≡ hk
                                                                            10−4          10−2                        102             104
       but it needs a few modiﬁcations for the new physical situa­
       tion.
                                                                                   Shallow water     10−2            Deep water
                                                                                      Gravity                         Gravity
       In deep water the slab has depth 1/k. In shallow water, how­
       ever, where h  1/k, the bottom of the ocean arrives before                    10              −4

       that depth. So the shallow-water slab has depth h. Its length
       is still 1/k, and its width is still w. Because the depth changed, the argument about how the
       water ﬂows is slightly different. In deep water, where the slab has depth equal to length,
       the slab and surface move the same distance. In shallow water, with a slab thinner by hk,
       the surface moves more slowly than the slab because less water is being moved around.
       It moves more slowly by the factor hk. With wave height ξ and frequency ω, the surface
       moves with velocity ξω, so the slab moves (sideways) with velocity vslab ∼ ξω/hk. The

       10 Springs                                                                                                              123

       kinetic energy in the water is contained mostly in the slab, because the upward motion is
       much slower than the slab motion. This energy is

                                                                         ρwξ2 ω2
                                 KEshallow ∼ ρwh/k × (ξω/hk)2 ∼                  .
                                                                   hk3
                                                mass          v2

       This energy balances the potential energy, a computation we do for the two limiting cases:
       ripples and gravity waves.

10.1.13 Gravity waves on shallow water

       We ﬁrst specialize to gravity waves – the shaded region in the                                           γk 2
                                                                                                         Π3 ≡
                                                                                                                ρg
       ﬁgure – where water is shallow and wavelengths are long.
                                                                                                         104
       These conditions include tidal waves,waves generated by un­
       dersea earthquakes, and waves approaching a beach. For grav­                    Shallow water
                                                                                       Surface tension
                                                                                                                         Deep water
                                                                                                                       Surface tension
                                                                                                         102
       ity waves, the potential energy is
                                                                                                                                               Π1 ≡ hk
                               PE ∼ ρgwξ2 /k.                                   10−4          10−2                       102             104

       This energy came from the distortion of the surface, and it is    Shallow water 10  Deep water
                                                                                                         −2

                                                                            Gravity         Gravity
       the same in shallow water (as long as the wave amplitude is
       small compared with the depth and wavelength). [The dom­                        10                −4

       inant force (gravity or surface tension) determines the poten­
       tial energy. As we see when we study shallow-water ripples, in Section 10.1.15, the water
       depth determines the kinetic energy.]
       Balancing this energy against the kinetic energy gives:

                                           ρwξ2 ω2
                                                   ∼ ρgwξ2 /k .
                                             hk3
                                                
                                                              PE
                                                KE

       So

                                                ω2 = 1×ghk2 .

       Once again, the correct, honestly calculated dimensionless constant (in red) is unity. So, for
       gravity waves on shallow water, the function f has the form

                                                           γk2
                                           fshallow (kh,       ) = kh.
                                                           ρg

       Since ω ∝ k1 , the group and phase velocities are equal and independent of frequency:
                                                   ω 
                                            vph = = gh,
                                                   k
                                                   ∂ω 
                                             vg =      = gh.
                                                   ∂k

       Shallow water is nondispersive: All frequencies move at the same velocity, so pulses com­
       posed of various frequencies propagate without smearing.

10.1.14 Tidal waves

       Undersea earthquakes illustrate the danger in such unity. If an earthquake strikes off the
       coast of Chile, dropping the seaﬂoor, it generates a shallow-water wave. This wave travels
                                                              √
       without distortion to Japan. The wave speed is v ∼ 4000 m × 10 m s−2 ∼ 200 m s−1 : The
       wave can cross a 104 km ocean in half a day. As it approaches shore, where the depth
       decreases, the wave slows, grows in amplitude, and becomes a large, destructive wave
       hitting land.

10.1.15 Ripples on shallow water

       Ripples on shallow water – the shaded region in the ﬁgure –                                      γk 2
                                                                                                 Π3 ≡
                                                                                                        ρg
       are rare. They occur when raindrops land in a shallow rain
                                                                                                 104
       puddle, one whose depth is less than 1 mm. Even then, only
       the longest-wavelength ripples, where λ ∼ 1 cm, can feel the           Shallow water
                                                                              Surface tension
                                                                                                                 Deep water
                                                                                                               Surface tension
                                                                                                 102
       bottom of the puddle (the requirement for the wave to be a
       shallow-water wave). The potential energy of the surface is                                                                     Π1 ≡ hk
                                                                       10−4          10−2                        102             104
       given by

                                                                                                10−2
                         PEripple ∼ γΔA ∼ γwξ2 k.                             Shallow water
                                                                                 Gravity
                                                                                                                Deep water
                                                                                                                 Gravity

       Although that formula applied to deep water, the water depth                             10−4

       does not affect the potential energy, so we can use the same
       formula for shallow water.
       The dominant force – here, surface tension – determines the potential energy. Balancing the
       potential energy and the kinetic energy gives:

                                          ρwξ2 ω2 w
                                                 ∼ γ(kξ)2 .
                                            hk3   k
                                               
                                             KE            PE

       Then

                                                      γhk4
                                               ω2 ∼        .
                                                       ρ

       The phase velocity is
                                                       
                                                ω          γhk2
                                           vph = =              ,
                                                k           ρ

       and the group velocity is vg = 2vph (the form of the dispersion relation is ω ∝ k2 ). For
       h ∼ 1 mm, this speed is

       10 Springs                                                                                                            125

                                                                    1/2
                              0.07 N m−1 × 10−3 m × 3.6 · 105 m−2
                         v∼                                               ∼ 16 cm s−1 .
                                          10 kg m−3
```

10.1.16 Combining ripples and gravity waves on shallow water

```
       This result ﬁnishes the last two corners of the world of waves:                                       γk 2
                                                                                                      Π3 ≡
                                                                                                             ρg
       shallow-water ripples and gravity waves. Connect the cor­
                                                                                                      104
       ners to make an edge by studying general shallow-water waves.
       This region of the world of waves is shaded in the ﬁgure.                   Shallow water
                                                                                   Surface tension
                                                                                                                      Deep water
                                                                                                                    Surface tension
                                                                                                      102
       You can combine the dispersion relations for ripples with that
       for gravity waves using two equivalent methods. Either add                                                                           Π1 ≡ hk
                                                                              −4
                                                                                          10−2                        102             104
       the two extreme-case dispersion relations or use the effective 10
       gravitational ﬁeld in the gravity-wave dispersion relation. Ei­
                                                                                   Shallow water     10−2            Deep water
       ther method produces                                                           Gravity                         Gravity

                                           γhk2                                                      10−4
                            ω2 ∼ k2 gh +        .
                                            ρ
```

10.1.17 Combining deep- and shallow-water gravity waves

```
       Now examine the gravity-wave edge of the world, shaded in                                             γk 2
                                                                                                      Π3 ≡
                                                                                                             ρg
       the ﬁgure. The deep- and shallow-water dispersion relations
                                                                                                      104
       are:
                              "                                                    Shallow water                      Deep water

                       2        1, deep water;                                     Surface tension
                                                                                                      102
                                                                                                                    Surface tension

                     ω = gk ×
                                hk, shallow water.
       To interpolate between the two regimes requires a function 10          −4
                                                                                10        10 −2
                                                                                                     10                  2              4
                                                                                                                                            Π1 ≡ hk

        f (hk) that asymptotes to 1 as hk → ∞ and to hk as hk → 0.
       Arguments based on guessing functional forms have an hon­         Shallow water
                                                                            Gravity
                                                                                       10 Deep water
                                                                                           Gravity
                                                                                                      −2

       ored history in physics. Planck derived the blackbody spec­
       trum by interpolating between the high- and low-frequency                       10             −4

       limits of what was known at the time. We are not deriving
       quantum mechanics, but the principle is the same: In new areas, whether new to you or
       new to everyone, you need a bit of courage. One simple interpolating function is tanh hk.
       Then the one true gravity wave dispersion relation is:

                                             ω2 = gk tanh hk.

       This educated guess is plausible because tanh hk falls off exponentially as h → ∞, in agree­
       ment with the argument based on Laplace’s equation. In fact, this guess is correct.
```

10.1.18 Combining deep- and shallow-water ripples

```
       We now examine the ﬁnal edge: ripples in shallow and deep                                           γk 2
                                                                                                    Π3 ≡
                                                                                                           ρg
       water, as shown in the ﬁgure. In Section 10.1.17, tanh kh inter-
                                                                                                    104
       polated between hk and 1 as hk went from 0 to ∞ (as the water
       went from shallow to deep). Probably the same trick works                 Shallow water
                                                                                 Surface tension
                                                                                                                    Deep water
                                                                                                                  Surface tension
                                                                                                    102
       for ripples, because the Laplace-equation argument, which
       justiﬁed the tanh kh, does not depend on the restoring force.                                                                      Π1 ≡ hk
                                                                          10−4          10−2                        102             104
       The relevant dispersion relations:
                               3
                           2    γk /ρ, if kh  1;                                                  10−2
                         ω =
                                                                                 Shallow water                     Deep water
                                                                                    Gravity                         Gravity
                                γhk4 /ρ, if kh  1.
                                                                                                   10−4
       If we factor out γk3 /ρ, the necessary transformation becomes
       clear:

                                         2 γk3 " 1, if kh  1;
                                       ω =    ×
                                            ρ    hk, if kh  1.

       This ripple result looks similar to the gravity-wave result, so make the same replacement:
                                   "
                                     1, if kh  1,
                                                       becomes tanh kh.
                                     hk, if kh  1,
       Then you get the general ripple dispersion relation:

                                                    γk3
                                             ω2 =       tanh kh.
                                                     ρ

       This dispersion relation does not have much practical interest because, at the cost of greater
       complexity than the deep-water ripple dispersion relation, it adds coverage of only a rare
       case: ripples on ponds. We include it for completeness, to visit all four edges of the world,
       in preparation for the grand combination coming up next.

10.1.19 Combining all the analyses

       Now we can replace g with gtotal , to ﬁnd the One True Dispersion Relation:

                                         ω2 = (gk + γk3 /ρ) tanh kh.

       10 Springs                                                                                            127

                              5                                              8                      2
                 Shallow water                                                          Deep water
                                                    Ripples
                    Ripples                                                              Ripples
                                                    γk 3
                        γhk 4                   ω =2
                                                         tanh kh                              γk 3
                   2
                  ω =                                ρ                                  ω2 =
                         ρ                                                                     ρ

                                     6                                             9                     3
                   shallow                         �                 �                    deep water
                       � water 2 �                            γk   3
                             γhk            ω2 =       gk +              tanh kh                  γk 3
              ω 2 = k 2 gh +                                   ρ                       ω 2 = gk +
                              ρ                                                                    ρ

                                 4                                          7                        1
                 Shallow water                                                          Deep water
                                                    Gravity waves
                 Gravity waves                                                         Gravity waves
                                                   ω 2 = gk tanh kh
                  ω 2 = ghk 2                                                            ω 2 = gk

       Each box in the ﬁgure represents a special case. The numbers next to the boxes mark the
       order in which we studied that limit. In the ﬁnal step (9), we combined all the analyses
       into the superbox in the center, which contains the dispersion relation for all waves: grav­
       ity waves or ripples, shallow water or deep water. The arrows show how we combined
       smaller, more specialized corner boxes into the more general edge boxes (double ruled),
       and the edge regions into the universal center box (triple ruled).
       In summary, we studied water waves by investigating dispersion relations. We mapped the
       world of waves, explored the corners and then the edges, and assembled the pieces to form
       an understanding of the complex, complete solution. The whole puzzle, solved, is shown
       in the ﬁgure. Considering limiting cases and stitching them together makes the analysis
       tractable and comprehensible.

10.1.20 What you have learned

       1. Phase and group velocities. Phase velocity says how fast crests in a single wave move. In
          a packet of waves (several waves added together), group velocity is the phase velocity
          of the envelope.
       2. Discretize. A complicated functional relationship, such as a dispersion relation, is easier
          to understand in a discrete limit: for example, one that allows only two (ω, k) combina­
          tions. This discretization helped explain the meaning of group velocity.
       3. Four regimes. The four regimes of wave behavior are characterized by two dimensionless
          groups: a dimensionless depth and a dimensionless ratio of surface tension to gravita­
          tional energy.
       4. Look for springs. Look for springs when a problem has kinetic- and potential-energy
          reservoirs and energy oscillates between them. A key characteristic of spring motion is
          overshoot: The system must zoom past the equilibrium conﬁguration of zero potential
          energy.
```

5. Most missing constants are unity. In analyses of waves and springs, the missing dimen­
sionless constants are usually unity. This fortunate result comes from the virial theorem, which says that the average potential and kinetic energies are equal for a F ∝ r force (a spring force). So balancing the two energies is exact in this case.

6. Minimum speed. Objects moving below a certain speed (in deep water) generate no
waves. This minimum speed is the result of cooperation between gravity and surface tension. Gravity keeps long-wavelength waves moving quickly. Surface tension keeps short-wavelength waves moving quickly.

7. Shallow-water gravity waves are non-dispersive. Gravity waves on shallow water (which
```
                                                    
```

includes tidal waves on oceans!) travel at speed gh, independent of wavelength.

8. Froude number. The Froude number, a ratio of kinetic to potential energy, determines the
maximum speed of speedboats and of walking.

Exercises

AM–GM Prove the arithmetic mean–geometric mean inequality by another method than the circle in the text. Use AM–GM for the following problem normally done with calculus. You start with a unit square, cut equal squares from each corner, then fold the ﬂaps upwards to make a half-open box. How large should the squares be in order to maximize its volume?

Minima without calculus.

Impossible How can tidal waves on the ocean (typical depth ∼ 4 km) be considered shallow water?

Oven dish Partly ﬁll a rectangular glass oven dish with water and play with the waves. Give the dish a slight slap and watch the wave go back and forth. How does the wave speed time vary with depth of water? Does your data agree with the theory in this chapter?

Minimum-wave speed Take a toothpick and move it through a pan of water. By experiment, ﬁnd the speed at which no waves are generated. How well does it agree with the theory in this chapter?

Kelvin wedge Show that the opening angle in a ship wake is 2 sin−1 (1/3).

# Part 4. Backmatter

```
11.Bon voyage!   130
```

## 11. Bon voyage!

The theme of this book is how to understand new ﬁelds, whether the ﬁeld is known generally but is new to you; or the ﬁeld is new to everyone. In either case, certain ways of thinking promote understanding and long-term learning. This afterword illustrates these ways by using an example that has appeared twice in the book – the volume of a pyramid.

### 11.1 Remember nothing!

The volume is proportional to the height, because of the drilling-core argument. So V ∝ h. But a dimensionally correct expression for the volume needs two additional lengths. They can come only from b2 . So

```
                                               V ∼ bh2 .
```

But what is the constant? It turns out to be 1/3.

### 11.2 Connect to other problems

Is that 3 in the denominator new information to remember? No! That piece of information also connects to other problems. First, you can derive it by using special cases, which is the subject of Section 8.1. Second, 3 is also the dimensionality of space. That fact is not a coincidence. Consider the simpler but analogous problem of the area of a triangle. Its area is

```
                                                  1
                                               A = bh.
                                                  2
```

The area has a similar form as the volume of the pyramid: A constant times a factor related to the base times the height. In two dimensions the constant is 1/2. So the 1/3 is likely to arise from the dimensionality of space. That analysis makes the 3 easy to remember and thereby the whole formula for the volume. But there are two follow-up questions. The ﬁrst is: Why does the dimensionality of space matter? The special-cases argument explains it because you need pyramids for each direction of space (I say no more for the moment until we do the special-cases argument in lecture!).

```
    11 Bon voyage!                                                                           131
```

The second follow-up question is: Does the 3 occur in other problems and for the same reason? A related place is the volume of a sphere

```
                                                4
                                             V = πr3 .
                                                3
```

The ancient Greeks showed that the 3 in the 4/3 is the same 3 as in the pyramid volume. To explain their picture, I’ll use method to ﬁnd the area of a circle then use it to ﬁnd the volume of a sphere. Divide a circle into many pie wedges. To ﬁnd its area, cut somewhere on the circumference and unroll it into this shape:

Each pie wedge is almost a triangle, so its area is bh/2, where the height h is approximately r. The sum of all the bases is the circumference 2πr, so A = 2πr × r/2 = πr2 . Now do the same procedure with a sphere: Divide it into small pieces that are almost pyramids, then unfold it. The unfolded sphere has a base area of 4πr2 , which is the surface area of the sphere. So the volume of all the mini pyramids is

```
                                      1                      4
                                 V=     × height × basearea = πr3 .
                                      3     3
                                             r       4πr2
```

Voilà! So, if you remember the volume of a sphere – and most of us have had it etched into our minds during our schooling – then you know that the volume of a pyramid contains a factor of 3 in the denominator.

### 11.3 Percolation model

The moral of the preceding examples is to build connections. A physical illustration of this process is percolation. Imagine how oil diffuses through rock. The rock has pores through which oil moves from zone to zone. However, many pores are blocked by mineral deposits. How does the oil percolate through that kind of rock?

That question has led to an extensive mathematics research on the following idealized model. Imagine an inﬁnite two-dimensional lattice. Now add bonds between neighbors (horizontal or vertical, not diagonal) with probability pbond . The ﬁgure shows an example of a ﬁnite subsection of a percolation lattice where pbond = 0.4. Its largest cluster – the largest set of points connected to each other – is marked in red, and contains 13% of the

```
points.                                                                           cluster = 12%
                                                                                     p = 0.40
```

Here is what happens as pbond increases from 0.40 to 0.50 to 0.55 to 0.60:

```
cluster = 12%            cluster = 43%            cluster = 87%
   p = 0.40                 p = 0.50                 p = 0.55
```

The largest cluster occupies more and more of the lattice. For an inﬁnite lattice, a similar question is: What is the probability p∞ of

```
                                                                                   1
```

ﬁnding an inﬁnite connected sublattice? That probability is zero until pbond reaches a critical probability pc . The critical probability depends on the topology (what kind of lattice and how many dimensions) – for the two-dimensional square lattice, pc = 1/2 – but its existence is independent of topology. When pbond > pc , the probability of a ﬁnding an inﬁnite lattice becomes nonzero 0

```
and eventually reaches 1.0.                                                          0
                                                                                                        1
                                                                                              pbond
```

An analogy to learning is that each lattice point (each dot) is a fact or formula, and each bond links two facts. For long-lasting learning, you want the facts to support each other via their connections. Let’s say that you want the facts to become part of an inﬁnite and therefore self-supporting lattice. However, if your textbooks or way of learning means that you just add more dots – learn just more facts – then you decrease pbond , so you decrease the chance of an inﬁnite clusters. If the analogy is more exact than I think it is, you might even eliminate inﬁnite clusters altogether. The opposite approach is to ensure that, with each fact, you create links to facts that you already know. In the percolation model, you add bonds between the dots in order to increase pbond . A famous English writer gave the same advice about life that I am giving about learning: Only connect! That was the whole of her sermon. . . Live in fragments no longer! [E. M. Forster, Howard’s End] The ways of reasoning presented in this book offer some ways to build those connections. Bon voyage as you learn and discover new ideas and the links between them!

Bibliography

[1] Mike Gancarz. Linux and the Unix Philosophy. Digital Press, 2nd revised edition, 2002. [2] Brian W. Kernighan and Rob Pike. The Unix Programming Environment. Prentice Hall, 1984. [3] Eric S. Raymond. The Art of UNIX Programming. Addison-Wesley, 2003. [4] Knut Schmid-Nielsen. Scaling: Why Animal Size is So Important. Cambridge University Press, Cambridge, England, 1984. [5] R. David Middlebrook. Methods of design-oriented analysis: Low-entropy expressions. In New Approaches to Undergraduate Engineering Education IV, 1992. See mit.edu/6.969/www/. [6] . [7] Richard Feynman, Robert B. Leighton and Matthew Sands. The Feynman Lectures on Physics, volume I. Addison-Wesley, Reading, MA, 1963a. [8] Bertrand Russell. A History of Western Philosophy, and Its Connection with Political and Social Circumstances from the Earliest Times to the Present Day. Simon and Schuster, New York, 1945. [9] E. Buckingham. On physically similar systems. Physical Review, 4(4):345–376, 1914. [10] S. Chandrasekhar. An Introduction to the Study of Stellar Structure. University of Chicago Press, Chicago, Ill., 1939. [11] S. Chandrasekhar. Hydrodynamic and Hydromagnetic Stability. Oxford University Press, Oxford, 1961. [12] Horace Lamb. Hydrodynamics. Dover, New York, 6th edition, 1932/1993. [13] Steven Vogel. Life in Moving Fluids: The Physical Biology of Flow. Princeton University Press, Princeton, NJ, 1994. [14] E. M. Purcell. Life at low Reynolds number. American Journal of Physics, 45:3–11, 1977. [15] David R. Lide, editor. CRC Handbook of Chemistry and Physics: A Ready-Reference Book of Chemical and Physical Data. CRC Press, Boca Raton, FL, 82nd edition, 1993. [16] Albert Einstein. The principle of relativity. Dover Publications, New York, 1952 [1923]. [17] Albert Einstein. Relativity: The special and the general theory. Three Rivers Press, reprint edition, 1995. [18] T. E. Faber. Fluid Dynamics for Physicists. Cambridge University Press, Cambridge, England, 1995.

[19] Horace Lamb. Hydrodynamics. Dover, New York, Sixth edition, 1945. [20] Carl Bernstein and Bob Woodward. All the President’s Men. Simon and Schuster, New York, 1974.

Index

```
a                               i
atomic theory 2–54              intensive quantities 3–73
attenuation 3–98                isoperimetric theorem 2–24

b                               m
balancing 2–61                  Mach number 3–102
Bohr radius 2–55
                                n
c                               nondispersive    3–124
cheap minimization 2–59
conﬁnement energy 2–58          o
                                of order unity   2–61
d
dispersion 3–98                 p
dispersion relations 3–97       phase velocity 3–98
dispersive 3–112
drag coefﬁcient 3–87            r
                                Reynolds number     3–76
e
equivalence principle   3–101   u
                                uncertainty energy 2–58
f                               uncertainty principle 2–58
Froude number 3–113             universal constant 2–53

g
group velocity   3–98
```

